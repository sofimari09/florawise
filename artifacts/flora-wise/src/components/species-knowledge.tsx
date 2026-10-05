import { Droplets, ExternalLink, Thermometer, Wind } from "lucide-react";
import { getGetSpeciesKnowledgeQueryKey, useGetSpeciesKnowledge } from "@workspace/api-client-react";
import type { PlantSpecies } from "@workspace/api-client-react";
import { Alert, Chip, careTypeLabel, envLabel } from "./fw-ui";

const dash = (v: unknown, suffix = "") => v === null || v === undefined || v === "" ? null : `${v}${suffix}`;
const fmtDate = (d: string | null) => d ? new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(d)) : null;

export function SpeciesDetails({ species: s }: { species: PlantSpecies }) {
  const knowledge = useGetSpeciesKnowledge(s.id, { query: { queryKey: getGetSpeciesKnowledgeQueryKey(s.id), retry: false } });
  const facts: Array<[string, string | null]> = [
    ["Наукова назва", dash(s.scientificName)],
    ["Категорія", dash(s.category)],
    ["Середовище", s.suitableEnvironmentTypes?.length ? s.suitableEnvironmentTypes.map(e => envLabel[e] || e).join(", ") : null],
    ["Вологість повітря", s.humidityMin != null || s.humidityMax != null ? `${s.humidityMin ?? "—"}–${s.humidityMax ?? "—"}%` : null],
    ["Підживлення", s.fertilizingFrequencyDays != null ? `кожні ${s.fertilizingFrequencyDays} дн.` : null],
    ["Сезон обрізки", dash(s.pruningSeason)],
    ["Пересадка", s.transplantingFrequencyMonths != null ? `раз на ${s.transplantingFrequencyMonths} міс.` : null],
  ];
  const shown = facts.filter(([, v]) => v);
  const texts: Array<[string, string | null | undefined]> = [
    ["Світло", s.lightRequirements], ["Полив", s.wateringRecommendations], ["Ґрунт", s.soilRecommendations], ["Підживлення", s.fertilizingRecommendations],
    ["Обрізка", s.pruningRecommendations], ["Пересадка", s.transplantingRecommendations], ["Збір урожаю", s.harvestingRecommendations], ["Загальні поради", s.generalCareRecommendations || s.careRecommendations],
  ];
  const k = knowledge.data;
  return <div className="space-y-5 text-sm leading-6" data-testid={`details-species-${s.id}`}>
    {shown.length > 0 && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">{shown.map(([a, b]) => <div key={a} className="rounded-xl bg-muted p-3"><dt className="text-xs text-muted-foreground">{a}</dt><dd className="mt-0.5 font-semibold">{b}</dd></div>)}</dl>}
    <div className="grid gap-3 sm:grid-cols-2">{texts.filter(([, v]) => v && v.trim()).map(([a, v]) => <div key={a}><p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">{a}</p><p className="mt-1 text-muted-foreground">{v}</p></div>)}</div>
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Правила догляду</p>
      {knowledge.isLoading && <div className="fw-skeleton mt-2 h-14 rounded-xl" />}
      {knowledge.error && <div className="mt-2"><Alert>Не вдалося завантажити знання про вид. <button type="button" className="font-semibold underline" onClick={() => knowledge.refetch()}>Повторити</button></Alert></div>}
      {k && k.careRules.length === 0 && <p className="mt-1 text-muted-foreground">Погодні правила для цього виду ще не додано.</p>}
      {k && k.careRules.length > 0 && <ul className="mt-2 space-y-2">{k.careRules.map((r, i) => <li key={i} className="rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{careTypeLabel[r.careType] || r.careType}</span>
          {r.rainThresholdMm != null && <Chip><Droplets size={12} className="mr-1" />дощ від {r.rainThresholdMm} мм</Chip>}
          {r.maxWindSpeedMps != null && <Chip><Wind size={12} className="mr-1" />вітер від {r.maxWindSpeedMps} м/с</Chip>}
          {(r.minTemperature != null || r.maxTemperature != null) && <Chip><Thermometer size={12} className="mr-1" />{r.minTemperature ?? "—"}…{r.maxTemperature ?? "—"}°C</Chip>}</div>
        {r.notes && <p className="mt-1 text-muted-foreground">{r.notes}</p>}</li>)}</ul>}
    </div>
    {k && k.sources.length > 0 && <div>
      <p className="font-mono text-[10px] uppercase tracking-[.16em] text-primary">Джерела</p>
      <ul className="mt-2 space-y-1.5">{k.sources.map((src, i) => <li key={i} className="text-muted-foreground">
        {src.sourceUrl ? <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">{src.sourceName}<ExternalLink size={12} /></a> : <span className="font-semibold text-foreground">{src.sourceName}</span>}
        {src.retrievedAt && <span> · отримано {fmtDate(src.retrievedAt)}</span>}{src.notes && <span> · {src.notes}</span>}</li>)}</ul>
    </div>}
  </div>;
}
