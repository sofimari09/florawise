import { z } from "zod/v4";
import { PLANT_CATEGORIES, isCategory } from "@workspace/plant-care";

export const identityInput = {
  name: z.string().optional(),
  personalName: z.string().nullable().optional(),
  speciesId: z.number().int().positive().nullable(),
  category: z.enum(PLANT_CATEGORIES).nullable().optional(),
};

/** Explicit null enters custom identity; omission in PATCH preserves the mode. */
export function resolveIdentityFields(
  data: { speciesId?: number | null; category?: string | null; name?: string; personalName?: string | null },
  existing?: { speciesId: number | null; category: string | null; name: string },
) {
  const speciesId = data.speciesId === undefined ? existing?.speciesId : data.speciesId;
  if (speciesId === undefined) throw new Error("Оберіть вид із довідника або додайте іншу рослину");
  if (speciesId !== null) {
    if (data.category != null) throw new Error("Категорія рослини з довідника визначається лише видом");
    return { speciesId, category: null };
  }
  const switching = existing?.speciesId !== null;
  const category = data.category === undefined && !switching ? existing?.category : data.category;
  const name = (data.name === undefined && !switching ? existing?.name : data.name)?.trim();
  if (!isCategory(category)) throw new Error("Оберіть категорію рослини вручну");
  if (!name) throw new Error("Вкажіть непорожню назву рослини");
  if (data.personalName != null) throw new Error("Для рослини поза довідником використовуйте назву, а не псевдонім виду");
  return { speciesId: null, category, name, personalName: null };
}

export const normalizeSearch = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("uk-UA");

/** Legacy name is accepted only as an alias, never as botanical identity. */
export function resolvePlantName(
  data: { name?: string; personalName?: string | null },
  speciesName: string,
  existing?: { personalName: string | null },
) {
  const supplied = data.personalName !== undefined ? data.personalName : data.name;
  const personalName = supplied === undefined
    ? existing?.personalName ?? null
    : supplied?.trim() || null;
  return { personalName, name: personalName ?? speciesName };
}
