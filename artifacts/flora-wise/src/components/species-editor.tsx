import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  getGetSpeciesKnowledgeQueryKey, getListSpeciesQueryKey, useCreateSpecies, useGetSpeciesKnowledge, useUpdateSpecies, useUpdateSpeciesKnowledge,
} from "@workspace/api-client-react";
import type { KnowledgeSource, PlantSpecies, SpeciesCareRule } from "@workspace/api-client-react";
import { Alert, Btn, Modal, careTypeLabel, environmentOptions, errMsg, inputCls, toDateInput } from "./fw-ui";

type Txt = "name" | "scientificName" | "category" | "pruningSeason" | "description" | "careRecommendations" | "lightRequirements" | "soilRecommendations" | "wateringRecommendations" | "fertilizingRecommendations" | "pruningRecommendations" | "transplantingRecommendations" | "harvestingRecommendations" | "generalCareRecommendations" | "imageUrl";
type Num = "optimalTempMin" | "optimalTempMax" | "optimalHumidity" | "wateringFrequencyDays" | "humidityMin" | "humidityMax" | "fertilizingFrequencyDays" | "transplantingFrequencyMonths";
const textFields: Array<[Txt, string, boolean]> = [
  ["name", "Назва виду", false], ["scientificName", "Наукова назва", false], ["category", "Категорія", false], ["pruningSeason", "Сезон обрізки", false], ["imageUrl", "Посилання на зображення", false],
  ["description", "Опис", true], ["lightRequirements", "Вимоги до освітлення", true], ["careRecommendations", "Загальний догляд (коротко)", true], ["generalCareRecommendations", "Розширені поради з догляду", true],
  ["soilRecommendations", "Ґрунт", true], ["wateringRecommendations", "Полив", true], ["fertilizingRecommendations", "Підживлення", true], ["pruningRecommendations", "Обрізка", true],
  ["transplantingRecommendations", "Пересадка", true], ["harvestingRecommendations", "Збір урожаю", true],
];
const numFields: Array<[Num, string, boolean]> = [
  ["optimalTempMin", "Мін. температура, °C", true], ["optimalTempMax", "Макс. температура, °C", true], ["optimalHumidity", "Оптимальна вологість, %", true], ["wateringFrequencyDays", "Полив, днів між", true],
  ["humidityMin", "Вологість від, %", false], ["humidityMax", "Вологість до, %", false], ["fertilizingFrequencyDays", "Підживлення, днів між", false], ["transplantingFrequencyMonths", "Пересадка, місяців між", false],
];
const careTypes = Object.keys(careTypeLabel).filter(k => k !== "OTHER") as SpeciesCareRule["careType"][];
type RuleRow = { careType: SpeciesCareRule["careType"]; rain: string; wind: string; min: string; max: string; notes: string };
type SrcRow = { sourceName: string; sourceUrl: string; retrievedAt: string; notes: string };
const n2s = (v: number | null | undefined) => v == null ? "" : String(v);
const s2n = (v: string) => v.trim() === "" ? null : Number(v);

export function SpeciesEditor({ species, onClose }: { species?: PlantSpecies | null; onClose: () => void }) {
  const q = useQueryClient();
  const create = useCreateSpecies();
  const update = useUpdateSpecies();
  const saveKnowledge = useUpdateSpeciesKnowledge();
  const editId = species?.id ?? null;
  const knowledge = useGetSpeciesKnowledge(editId ?? 0, { query: { queryKey: getGetSpeciesKnowledgeQueryKey(editId ?? 0), enabled: editId !== null, retry: false } });
  const [txt, setTxt] = useState<Record<Txt, string>>(() => Object.fromEntries(textFields.map(([k]) => [k, (species?.[k] as string | null | undefined) ?? ""])) as Record<Txt, string>);
  const [num, setNum] = useState<Record<Num, string>>(() => Object.fromEntries(numFields.map(([k, , req]) => [k, species ? n2s(species[k] as number | null | undefined) : req ? ({ optimalTempMin: "18", optimalTempMax: "28", optimalHumidity: "55", wateringFrequencyDays: "7" } as Record<string, string>)[k] ?? "" : ""])) as Record<Num, string>);
  const [envs, setEnvs] = useState<string[]>(species?.suitableEnvironmentTypes ?? []);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [sources, setSources] = useState<SrcRow[]>([]);
  const [error, setError] = useState("");
  const seeded = useRef(false);
  useEffect(() => {
    if (knowledge.data && !seeded.current) {
      seeded.current = true;
      setRules(knowledge.data.careRules.map(r => ({ careType: r.careType, rain: n2s(r.rainThresholdMm), wind: n2s(r.maxWindSpeedMps), min: n2s(r.minTemperature), max: n2s(r.maxTemperature), notes: r.notes ?? "" })));
      setSources(knowledge.data.sources.map(s => ({ sourceName: s.sourceName, sourceUrl: s.sourceUrl ?? "", retrievedAt: toDateInput(s.retrievedAt), notes: s.notes ?? "" })));
    }
  }, [knowledge.data]);
  const pending = create.isPending || update.isPending || saveKnowledge.isPending;
  const patchRule = (i: number, p: Partial<RuleRow>) => setRules(r => r.map((x, k) => k === i ? { ...x, ...p } : x));
  const patchSrc = (i: number, p: Partial<SrcRow>) => setSources(r => r.map((x, k) => k === i ? { ...x, ...p } : x));

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError("");
    if (!txt.name.trim()) { setError("Вкажіть назву виду."); return; }
    for (const [k, label, req] of numFields) if (req && num[k].trim() === "") { setError(`Заповніть поле «${label}».`); return; }
    for (const [k, label] of numFields) if (num[k].trim() !== "" && !Number.isFinite(Number(num[k]))) { setError(`Поле «${label}» має бути числом.`); return; }
    if (sources.some(s => !s.sourceName.trim())) { setError("Вкажіть назву для кожного джерела."); return; }
    for (const s of sources) if (s.sourceUrl.trim() && !/^https?:\/\//i.test(s.sourceUrl.trim())) { setError("Посилання на джерело має починатися з http:// або https://."); return; }
    if (editId !== null && !seeded.current) { setError("Дочекайтеся завантаження правил і джерел, щоб не втратити їх."); return; }
    const nullable = (v: string) => v.trim() === "" ? null : v.trim();
    const payload = {
      ...(species ?? {}),
      name: txt.name.trim(), description: txt.description, careRecommendations: txt.careRecommendations, lightRequirements: txt.lightRequirements, soilRecommendations: txt.soilRecommendations,
      wateringRecommendations: txt.wateringRecommendations, fertilizingRecommendations: txt.fertilizingRecommendations, pruningRecommendations: txt.pruningRecommendations,
      transplantingRecommendations: txt.transplantingRecommendations, imageUrl: txt.imageUrl,
      scientificName: nullable(txt.scientificName), category: nullable(txt.category), pruningSeason: nullable(txt.pruningSeason),
      harvestingRecommendations: nullable(txt.harvestingRecommendations), generalCareRecommendations: nullable(txt.generalCareRecommendations),
      suitableEnvironmentTypes: envs.length ? envs : null,
      optimalTempMin: Number(num.optimalTempMin), optimalTempMax: Number(num.optimalTempMax), optimalHumidity: Number(num.optimalHumidity), wateringFrequencyDays: Number(num.wateringFrequencyDays),
      humidityMin: s2n(num.humidityMin), humidityMax: s2n(num.humidityMax), fertilizingFrequencyDays: s2n(num.fertilizingFrequencyDays), transplantingFrequencyMonths: s2n(num.transplantingFrequencyMonths),
    };
    const careRules: SpeciesCareRule[] = rules.map(r => ({ careType: r.careType, rainThresholdMm: s2n(r.rain), maxWindSpeedMps: s2n(r.wind), minTemperature: s2n(r.min), maxTemperature: s2n(r.max), notes: nullable(r.notes) }));
    const srcs: KnowledgeSource[] = sources.map(s => ({ sourceName: s.sourceName.trim(), sourceUrl: nullable(s.sourceUrl), retrievedAt: s.retrievedAt || null, notes: nullable(s.notes) }));
    const finish = (id: number) => saveKnowledge.mutate({ id, data: { careRules, sources: srcs } }, {
      onSuccess: () => { q.invalidateQueries({ queryKey: getListSpeciesQueryKey() }); q.invalidateQueries({ queryKey: getGetSpeciesKnowledgeQueryKey(id) }); onClose(); },
      onError: err => { q.invalidateQueries({ queryKey: getListSpeciesQueryKey() }); setError(errMsg(err, "Вид збережено, але правила й джерела зберегти не вдалося.")); },
    });
    const fail = (err: unknown) => setError(errMsg(err, "Не вдалося зберегти вид."));
    if (editId !== null) update.mutate({ id: editId, data: { ...payload, id: editId } }, { onSuccess: () => finish(editId), onError: fail });
    else create.mutate({ data: { ...payload, id: 0 } }, { onSuccess: saved => finish(saved.id), onError: fail });
  };

  const sec = "font-mono text-[10px] uppercase tracking-[.18em] text-primary";
  return <Modal title={species ? `Редагувати: ${species.name}` : "Новий вид"} onClose={onClose} wide>
    <form onSubmit={submit} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">{textFields.filter(([, , area]) => !area).map(([k, label]) => <label key={k} className="text-sm font-semibold">{label}<input data-testid={`input-species-${k}`} value={txt[k]} onChange={e => setTxt({ ...txt, [k]: e.target.value })} className={inputCls} /></label>)}</div>
      <div><p className={sec}>Числові параметри</p><div className="mt-2 grid gap-3 sm:grid-cols-4">{numFields.map(([k, label]) => <label key={k} className="text-xs font-semibold">{label}<input data-testid={`input-species-${k}`} type="number" step="any" value={num[k]} onChange={e => setNum({ ...num, [k]: e.target.value })} className={inputCls} /></label>)}</div></div>
      <div><p className={sec}>Підходящі середовища</p><div className="mt-2 flex flex-wrap gap-3">{environmentOptions.map(o => <label key={o.value} className="flex items-center gap-2 text-sm"><input type="checkbox" data-testid={`checkbox-species-env-${o.value}`} checked={envs.includes(o.value)} onChange={e => setEnvs(v => e.target.checked ? [...v, o.value] : v.filter(x => x !== o.value))} className="accent-primary" />{o.label}</label>)}</div></div>
      <div className="grid gap-3 sm:grid-cols-2">{textFields.filter(([, , area]) => area).map(([k, label]) => <label key={k} className="text-sm font-semibold">{label}<textarea data-testid={`input-species-${k}`} rows={2} value={txt[k]} onChange={e => setTxt({ ...txt, [k]: e.target.value })} className={inputCls} /></label>)}</div>

      <div className="border-t border-border pt-5"><div className="flex items-center justify-between"><p className={sec}>Правила догляду за погодою</p><Btn variant="soft" onClick={() => setRules(r => [...r, { careType: "WATERING", rain: "", wind: "", min: "", max: "", notes: "" }])} testId="button-add-rule"><Plus size={14} /> Правило</Btn></div>
        {editId !== null && knowledge.isLoading && <div className="fw-skeleton mt-3 h-14 rounded-xl" />}
        {editId !== null && knowledge.error && <div className="mt-3"><Alert>Не вдалося завантажити поточні правила. Збереження вимкнено, щоб не стерти їх. <button type="button" className="font-semibold underline" onClick={() => knowledge.refetch()}>Повторити</button></Alert></div>}
        <div className="mt-3 space-y-3">{rules.map((r, i) => <div key={i} data-testid={`row-rule-${i}`} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-5">
          <label className="text-xs font-semibold">Тип<select value={r.careType} onChange={e => patchRule(i, { careType: e.target.value as RuleRow["careType"] })} className={inputCls}>{careTypes.map(t => <option key={t} value={t}>{careTypeLabel[t]}</option>)}</select></label>
          <label className="text-xs font-semibold">Дощ, мм<input type="number" min="0" step="any" value={r.rain} onChange={e => patchRule(i, { rain: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold">Вітер, м/с<input type="number" min="0" step="any" value={r.wind} onChange={e => patchRule(i, { wind: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold">Темп. від<input type="number" step="any" value={r.min} onChange={e => patchRule(i, { min: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold">Темп. до<input type="number" step="any" value={r.max} onChange={e => patchRule(i, { max: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold sm:col-span-4">Нотатки<input value={r.notes} onChange={e => patchRule(i, { notes: e.target.value })} className={inputCls} /></label>
          <div className="flex items-end justify-end"><Btn variant="danger" onClick={() => setRules(x => x.filter((_, k) => k !== i))}><Trash2 size={14} /></Btn></div>
        </div>)}</div>
      </div>

      <div className="border-t border-border pt-5"><div className="flex items-center justify-between"><p className={sec}>Джерела</p><Btn variant="soft" onClick={() => setSources(r => [...r, { sourceName: "", sourceUrl: "", retrievedAt: "", notes: "" }])} testId="button-add-source"><Plus size={14} /> Джерело</Btn></div>
        <div className="mt-3 space-y-3">{sources.map((s, i) => <div key={i} data-testid={`row-source-${i}`} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Назва джерела<input value={s.sourceName} onChange={e => patchSrc(i, { sourceName: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold">Посилання (необов’язково)<input value={s.sourceUrl} onChange={e => patchSrc(i, { sourceUrl: e.target.value })} placeholder="https://…" className={inputCls} /></label>
          <label className="text-xs font-semibold">Дата отримання<input type="date" value={s.retrievedAt} onChange={e => patchSrc(i, { retrievedAt: e.target.value })} className={inputCls} /></label>
          <label className="text-xs font-semibold">Нотатки<input value={s.notes} onChange={e => patchSrc(i, { notes: e.target.value })} className={inputCls} /></label>
          <div className="flex justify-end sm:col-span-2"><Btn variant="danger" onClick={() => setSources(x => x.filter((_, k) => k !== i))}><Trash2 size={14} /> Прибрати</Btn></div>
        </div>)}</div>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Скасувати</Btn><Btn type="submit" disabled={pending || (editId !== null && !!knowledge.error)} testId="button-save-species">{pending ? "Зберігаємо…" : "Зберегти вид"}</Btn></div>
    </form>
  </Modal>;
}
