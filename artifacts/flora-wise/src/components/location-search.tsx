import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Crosshair, MapPin, Search } from "lucide-react";
import { getListSavedLocationsQueryKey, useCreateSavedLocation, useSearchLocations } from "@workspace/api-client-react";
import type { LocationSuggestion, SavedLocation } from "@workspace/api-client-react";
import { Alert, Btn, errMsg, inputCls } from "./fw-ui";

/** Explicit search (on submit only) + browser geolocation; saves the chosen place as a SavedLocation. */
export function LocationSearch({ onSaved, makeDefault = false }: { onSaved: (location: SavedLocation) => void; makeDefault?: boolean }) {
  const q = useQueryClient();
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const create = useCreateSavedLocation();
  const search = useSearchLocations({ q: submitted }, { query: { queryKey: ["location-search", submitted], enabled: submitted.length >= 3, retry: false, staleTime: 5 * 60_000 } });

  const save = (s: LocationSuggestion) => {
    setError("");
    create.mutate({ data: { displayName: s.displayName, latitude: s.latitude, longitude: s.longitude, isDefault: makeDefault } }, {
      onSuccess: loc => { q.invalidateQueries({ queryKey: getListSavedLocationsQueryKey() }); setSubmitted(""); setText(""); onSaved(loc); },
      onError: e => setError(errMsg(e, "Не вдалося зберегти локацію.")),
    });
  };
  const submit = () => {
    if (text.trim().length < 3) { setError("Введіть щонайменше 3 символи для пошуку."); return; }
    setError("");
    if (submitted === text.trim()) void search.refetch();
    else setSubmitted(text.trim());
  };
  const locate = () => {
    setError("");
    if (!navigator.geolocation) { setError("Браузер не підтримує визначення місцезнаходження."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { setLocating(false); save({ displayName: "Моє місцезнаходження", latitude: coords.latitude, longitude: coords.longitude }); },
      () => { setLocating(false); setError("Не вдалося визначити місцезнаходження. Перевірте дозвіл браузера або скористайтеся пошуком."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };
  const results = search.data ?? [];
  return <div>
    <p className="mb-3 text-xs leading-5 text-muted-foreground" data-testid="text-osm-attribution">Пошук виконується через OpenStreetMap лише після натискання «Знайти»: ваш запит надсилається до цього сервісу. Дані: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="font-semibold text-primary hover:underline">© OpenStreetMap</a>.</p>
    <div role="search" className="flex flex-wrap items-end gap-2">
      <label className="min-w-[200px] flex-1 text-sm font-semibold">Знайти місто або адресу<input data-testid="input-location-search" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); } }} placeholder="Наприклад, Львів" className={inputCls} /></label>
      <Btn onClick={submit} variant="soft" disabled={search.isFetching} testId="button-location-search"><Search size={15} /> {search.isFetching ? "Шукаємо…" : "Знайти"}</Btn>
      <Btn variant="ghost" onClick={locate} disabled={locating || create.isPending} testId="button-location-geolocate"><Crosshair size={15} /> {locating ? "Визначаємо…" : "Моє місцезнаходження"}</Btn>
    </div>
    {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    {search.error && <div className="mt-3"><Alert>Пошук тимчасово недоступний. Спробуйте пізніше.</Alert></div>}
    {submitted && !search.isFetching && !search.error && (results.length === 0
      ? <p className="mt-3 text-sm text-muted-foreground">Нічого не знайдено за запитом «{submitted}».</p>
      : <ul className="mt-3 divide-y divide-border/70 rounded-xl border border-border">{results.map((s, i) => <li key={`${s.displayName}-${i}`} className="flex items-center gap-3 p-3"><MapPin size={16} className="shrink-0 text-primary" /><span className="flex-1 text-sm">{s.displayName}</span><Btn variant="soft" onClick={() => save(s)} disabled={create.isPending} testId={`button-location-pick-${i}`}>Зберегти</Btn></li>)}</ul>)}
  </div>;
}
