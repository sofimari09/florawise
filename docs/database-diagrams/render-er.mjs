import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

function parseDbml(fileName) {
  const lines = fs.readFileSync(path.join(directory, fileName), "utf8").split(/\r?\n/u);
  const tables = [];
  const refs = [];
  let current = null;
  let depth = 0;

  for (const line of lines) {
    const start = line.match(/^Table\s+([a-z0-9_]+)\s+\{/iu);
    if (start) {
      current = { name: start[1], fields: [] };
      tables.push(current);
      depth = 1;
      continue;
    }
    if (current) {
      if (depth === 1) {
        const field = line.match(/^\s{2}([a-z][a-z0-9_]*)\s+([a-z][a-z0-9_]*(?:\([^)]*\))?(?:\[\])?)(?:\s+\[(.*)\])?\s*$/iu);
        if (field) {
          const options = field[3] ?? "";
          current.fields.push({
            name: field[1],
            type: field[2],
            primary: /\bpk\b/iu.test(options),
            unique: /\bunique\b/iu.test(options),
            required: /\bnot null\b/iu.test(options),
          });
        }
      }
      depth += (line.match(/\{/gu) ?? []).length;
      depth -= (line.match(/\}/gu) ?? []).length;
      if (depth === 0) current = null;
      continue;
    }
    const ref = line.match(/^Ref:\s+([a-z0-9_]+)\.([a-z0-9_]+)\s+<\s+([a-z0-9_]+)\.([a-z0-9_]+)/iu);
    if (ref) refs.push({ parent: ref[1], parentColumn: ref[2], child: ref[3], childColumn: ref[4] });
  }

  const byName = new Map(tables.map(table => [table.name, table]));
  for (const ref of refs) {
    const field = byName.get(ref.child)?.fields.find(item => item.name === ref.childColumn);
    if (field) {
      field.foreign = true;
      field.foreignOptional = !field.required;
    }
  }
  return { tables, refs };
}

const colors = {
  core: { header: "#2f6952", body: "#f2f8f3", border: "#b7d0bf" },
  knowledge: { header: "#5264a2", body: "#f2f4fb", border: "#c3cbe6" },
  care: { header: "#a75d2d", body: "#fff5ed", border: "#e5c3a9" },
  communication: { header: "#72507e", body: "#f7f1f8", border: "#d9c6df" },
  metadata: { header: "#626d78", body: "#f3f5f6", border: "#cbd1d6" },
};

function groupFor(tableName) {
  if (tableName === "flora_schema_migrations") return "metadata";
  if (tableName.includes("species") || tableName.includes("knowledge")) return "knowledge";
  if (["flora_users", "flora_plants", "flora_plant_places", "flora_saved_locations", "flora_plant_photos"].includes(tableName)) return "core";
  if (["flora_reports", "flora_notifications"].includes(tableName)) return "communication";
  return "care";
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function badges(field) {
  const result = [];
  if (field.primary) result.push(["PK", "#b08a32"]);
  if (field.foreign) result.push([field.foreignOptional ? "FK?" : "FK", field.foreignOptional ? "#5874aa" : "#47785a"]);
  if (field.unique) result.push(["UK", "#72507e"]);
  return result;
}

function renderDiagram({ fileName, outputName, title, subtitle, layout, mode }) {
  const { tables, refs } = parseDbml(fileName);
  const byName = new Map(tables.map(table => [table.name, table]));
  const includedNames = layout.flat().filter(Boolean);
  const included = includedNames.map(name => {
    const table = byName.get(name);
    if (!table) throw new Error(`${fileName}: layout refers to missing table ${name}`);
    return table;
  });
  if (new Set(includedNames).size !== includedNames.length) throw new Error(`${fileName}: duplicate table in layout`);
  const fieldCount = table => table.fields.length;
  const full = mode === "full";
  const width = full ? 3820 : 1190;
  const cardWidth = full ? 700 : 280;
  const headerHeight = full ? 44 : 32;
  const rowHeight = full ? 20 : 14;
  const cardPadding = full ? 14 : 9;
  const cardHeight = table => headerHeight + cardPadding * 2 + fieldCount(table) * rowHeight;
  const rowGap = full ? 30 : 12;
  const top = full ? 140 : 84;
  const columnGap = full ? 58 : 10;
  const leftMargin = full ? 40 : 20;
  const positions = new Map();
  let diagramHeight;

  if (full) {
    layout.forEach((column, col) => {
      let y = top;
      for (const name of column) {
        if (!name) continue;
        const table = byName.get(name);
        positions.set(name, { x: leftMargin + col * (cardWidth + columnGap), y, width: cardWidth, height: cardHeight(table), col });
        y += cardHeight(table) + rowGap;
      }
    });
    diagramHeight = Math.max(...[...positions.values()].map(box => box.y + box.height)) + 80;
  } else {
    let y = top;
    layout.forEach((row, rowIndex) => {
      const rowTables = row.filter(Boolean).map(name => byName.get(name));
      const rowHeightPx = Math.max(...rowTables.map(cardHeight));
      row.forEach((name, col) => {
        if (!name) return;
        positions.set(name, {
          x: leftMargin + col * (cardWidth + columnGap),
          y: y + (rowHeightPx - cardHeight(byName.get(name))) / 2,
          width: cardWidth,
          height: cardHeight(byName.get(name)),
          col,
        });
      });
      y += rowHeightPx + rowGap;
      if (rowIndex === layout.length - 1) diagramHeight = y + 48;
    });
  }

  const includedRefs = refs.filter(ref => positions.has(ref.parent) && positions.has(ref.child));
  const marker = full ? 8 : 6;
  const font = full ? 15 : 12;
  const typeFont = full ? 14 : 10.7;
  const elements = [];
  const rowCenter = (tableName, fieldName) => {
    const table = byName.get(tableName);
    const box = positions.get(tableName);
    const index = Math.max(0, table.fields.findIndex(field => field.name === fieldName));
    return box.y + headerHeight + cardPadding + index * rowHeight + rowHeight / 2;
  };

  includedRefs.forEach((ref, index) => {
    const parent = positions.get(ref.parent);
    const child = positions.get(ref.child);
    let startX;
    let endX;
    let laneX;
    if (parent.col < child.col) {
      startX = parent.x + parent.width;
      endX = child.x;
      laneX = (startX + endX) / 2 + ((index % 5) - 2) * (full ? 12 : 5);
    } else if (parent.col > child.col) {
      startX = parent.x;
      endX = child.x + child.width;
      laneX = (startX + endX) / 2 + ((index % 5) - 2) * (full ? 12 : 5);
    } else {
      const side = parent.x + parent.width + 22 < width - 10 ? "right" : "left";
      startX = side === "right" ? parent.x + parent.width : parent.x;
      endX = side === "right" ? child.x + child.width : child.x;
      laneX = side === "right" ? Math.max(startX, endX) + 22 + (index % 3) * 6 : Math.min(startX, endX) - 22 - (index % 3) * 6;
    }
    let startY = rowCenter(ref.parent, ref.parentColumn);
    let endY = rowCenter(ref.child, ref.childColumn);
    const fan = ((index % 7) - 3) * (full ? 3 : 1.5);
    startY = Math.max(parent.y + headerHeight + 8, Math.min(parent.y + parent.height - 8, startY + fan));
    endY = Math.max(child.y + headerHeight + 8, Math.min(child.y + child.height - 8, endY + fan));
    elements.push(`<path d="M ${startX} ${startY} C ${laneX} ${startY}, ${laneX} ${endY}, ${endX} ${endY}" fill="none" stroke="#75847a" stroke-width="${full ? 2 : 1.4}" stroke-opacity="${full ? 0.45 : 0.5}" marker-end="url(#arrow)"/>`);
  });

  for (const table of included) {
    const box = positions.get(table.name);
    const palette = colors[groupFor(table.name)];
    const hasPrimaryKey = table.fields.some(field => field.primary);
    const isJunction = table.name === "flora_species_knowledge_sources" || table.name === "flora_species_care_rule_sources";
    const titleSize = full ? 19 : 13.2;
    elements.push(`<g aria-label="${xml(table.name)}">`);
    elements.push(`<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${full ? 11 : 8}" fill="${palette.body}" stroke="${palette.border}" stroke-width="1.5"/>`);
    elements.push(`<path d="M ${box.x + 11} ${box.y} H ${box.x + box.width - 11} Q ${box.x + box.width} ${box.y} ${box.x + box.width} ${box.y + 11} V ${box.y + headerHeight} H ${box.x} V ${box.y + 11} Q ${box.x} ${box.y} ${box.x + 11} ${box.y}" fill="${palette.header}"/>`);
    elements.push(`<text x="${box.x + 12}" y="${box.y + (full ? 28 : 21)}" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700" fill="#ffffff">${xml(table.name)}</text>`);
    if (!hasPrimaryKey || isJunction) {
      const label = isJunction ? "JUNCTION · НЕМАЄ PK" : "НЕМАЄ PK";
      elements.push(`<text x="${box.x + box.width - 12}" y="${box.y + (full ? 28 : 21)}" text-anchor="end" font-family="Arial, sans-serif" font-size="${full ? 11 : 8.5}" font-weight="600" fill="#f4ecd9">${xml(label)}</text>`);
    }
    table.fields.forEach((field, index) => {
      const y = box.y + headerHeight + cardPadding + index * rowHeight + (full ? 15 : 10.5);
      if (index % 2 === 0) elements.push(`<rect x="${box.x + 1}" y="${y - rowHeight + (full ? 1 : 0.5)}" width="${box.width - 2}" height="${rowHeight}" fill="#ffffff" fill-opacity=".56"/>`);
      elements.push(`<text x="${box.x + (full ? 13 : 8)}" y="${y}" font-family="Arial, sans-serif" font-size="${font}" fill="#27332c">${xml(field.name)}</text>`);
      elements.push(`<text x="${box.x + (full ? 425 : 154)}" y="${y}" font-family="Arial, sans-serif" font-size="${typeFont}" fill="#69776d">${xml(field.type)}</text>`);
      const fieldBadges = badges(field);
      fieldBadges.forEach(([label, color], badgeIndex) => {
        const bw = label === "FK?" ? (full ? 34 : 29) : (full ? 29 : 24);
        const badgeX = box.x + box.width - (full ? 13 : 8) - bw - badgeIndex * (bw + 4);
        elements.push(`<rect x="${badgeX}" y="${y - (full ? 12 : 9)}" width="${bw}" height="${full ? 16 : 12}" rx="4" fill="${color}" fill-opacity=".15"/>`);
        elements.push(`<text x="${badgeX + bw / 2}" y="${y + (full ? 0 : -0.3)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${full ? 10 : 8.5}" font-weight="700" fill="${color}">${label}</text>`);
      });
    });
    elements.push("</g>");
  }

  const titleY = full ? 48 : 32;
  const subtitleY = full ? 78 : 56;
  const description = full
    ? `${tables.length} таблиць · ${refs.length} фізичних FK · ${tables.filter(table => table.fields.some(field => field.primary)).length} PK; показано всі колонки`
    : `${included.length} із 17 фактичних сутностей · вибрані атрибути · альбомний формат A4`;
  const footerY = diagramHeight - 18;
  const sourceKey = full
    ? "PK — первинний ключ · FK — обов’язковий зовнішній ключ · FK? — необов’язковий FK · UK — унікальність однієї колонки. Складені індекси та прикладні правила пояснено в супровідному описі."
    : "Стрілки — фізичні FK PostgreSQL; FK? позначає nullable-посилання. До скороченої схеми не включено таблиці фотографій і журналу міграцій.";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${full ? width : "297mm"}" height="${full ? diagramHeight : "210mm"}" viewBox="0 0 ${width} ${diagramHeight}" role="img" aria-labelledby="title desc">
  <title id="title">${xml(title)}</title>
  <desc id="desc">${xml(description)}</desc>
  <defs><marker id="arrow" markerWidth="${marker}" markerHeight="${marker}" refX="${marker - 1}" refY="${marker / 2}" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L ${marker} ${marker / 2} L 0 ${marker} z" fill="#75847a"/></marker></defs>
  <rect width="${width}" height="${diagramHeight}" fill="#fbfaf6"/>
  <text x="${leftMargin}" y="${titleY}" font-family="Arial, sans-serif" font-size="${full ? 31 : 22}" font-weight="700" fill="#233d31">${xml(title)}</text>
  <text x="${leftMargin}" y="${subtitleY}" font-family="Arial, sans-serif" font-size="${full ? 16 : 12}" fill="#607166">${xml(description)}</text>
  ${elements.join("\n  ")}
  <text x="${leftMargin}" y="${footerY}" font-family="Arial, sans-serif" font-size="${full ? 14 : 10.5}" fill="#516057">${xml(sourceKey)}</text>
</svg>`;
  fs.writeFileSync(path.join(directory, outputName), svg, "utf8");
}

renderDiagram({
  fileName: "florawise-full.dbml",
  outputName: "florawise-full.svg",
  title: "FloraWise — повна ER-схема",
  subtitle: "Поточна структура PostgreSQL",
  mode: "full",
  layout: [
    ["flora_users", "flora_species", "flora_schema_migrations", "flora_plant_photos"],
    ["flora_plants", "flora_plant_places", "flora_saved_locations", "flora_species_care_rules"],
    ["flora_tasks", "flora_knowledge_sources", "flora_species_knowledge_sources", "flora_species_care_rule_sources"],
    ["flora_recommendations", "flora_reports", "flora_care_logs", "flora_reminders"],
    ["flora_notifications"],
  ],
});

renderDiagram({
  fileName: "florawise-thesis.dbml",
  outputName: "florawise-thesis.svg",
  title: "FloraWise — основні сутності",
  subtitle: "Спрощена ER-схема для магістерської роботи",
  mode: "thesis",
  layout: [
    ["flora_users", "flora_plants", "flora_species", "flora_saved_locations"],
    ["flora_plant_places", "flora_tasks", "flora_recommendations", "flora_notifications"],
    ["flora_care_logs", "flora_reminders", "flora_species_care_rules", "flora_knowledge_sources"],
    ["flora_reports", "flora_species_knowledge_sources", "flora_species_care_rule_sources", null],
  ],
});
