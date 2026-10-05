import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImageOff } from "lucide-react";
import { getGetPlantQueryKey, getListPlantsQueryKey, useCreatePlant, useListPlantPlaces, useListSavedLocations, useListSpecies, useUpdatePlant } from "@workspace/api-client-react";
import type { Plant, PlantInput } from "@workspace/api-client-react";
import { Alert, Btn, Pnl, errMsg, inputCls } from "./fw-ui";
import { PlacePicker } from "./place-picker";
import { LocationSearch } from "./location-search";

export function PlantForm({ plant, onDone, onCancel }: { plant?: Plant | null; onDone: (plant: Plant, created: boolean) => void; onCancel: () => void }) {
  const q = useQueryClient();
  const species = useListSpecies();
  const places = useListPlantPlaces();
  const locations = useListSavedLocations();
  const create = useCreatePlant();
  const update = useUpdatePlant();
  const [name, setName] = useState(plant?.name ?? "");
  const [speciesId, setSpeciesId] = useState(plant ? String(plant.speciesId) : "");
  const [placeId, setPlaceId] = useState<number | null>(plant?.placeId ?? null);
  const [weatherId, setWeatherId] = useState<number | null>(plant?.weatherLocationId ?? null);
  const photoUrl = plant?.photoUrl ?? "";
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState("");
  const pending = create.isPending || update.isPending;

  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) { setError("Вкажіть назву рослини."); return; }
    if (!speciesId) { setError("Оберіть вид рослини."); return; }
    const place = (places.data ?? []).find(p => p.id === placeId);
    if (!plant && !place) { setError("Оберіть або створіть місце вирощування."); return; }
    const weather = (locations.data ?? []).find(l => l.id === weatherId);
    const data: PlantInput = {
      name: name.trim(),
      speciesId: Number(speciesId),
      location: place?.name ?? plant?.location ?? "",
      environmentType: place?.environmentType ?? plant?.environmentType,
      photoUrl,
      weatherLocationId: weatherId,
      weatherLocationName: weather?.displayName ?? null,
      weatherLatitude: weather?.latitude ?? null,
      weatherLongitude: weather?.longitude ?? null,
    };
    if (place) data.placeId = place.id;
    if (!data.location) { setError("Оберіть місце вирощування."); return; }
    const fail = (e: unknown) => setError(errMsg(e, "Не вдалося зберегти рослину. Перевірте дані й спробуйте ще раз."));
    if (plant) update.mutate({ id: plant.id, data }, { onSuccess: saved => { q.invalidateQueries({ queryKey: getListPlantsQueryKey() }); q.invalidateQueries({ queryKey: getGetPlantQueryKey(plant.id) }); onDone(saved, false); }, onError: fail });
    else create.mutate({ data }, { onSuccess: saved => { q.invalidateQueries({ queryKey: getListPlantsQueryKey() }); onDone(saved, true); }, onError: fail });
  };

  return <Pnl className="mb-6 p-6">
    <h2 className="mb-5 font-serif text-2xl">{plant ? "Редагувати рослину" : "Нова рослина"}</h2>
    <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
      <label className="min-w-0 text-sm font-semibold">Назва рослини<input data-testid="input-plant-name" value={name} onChange={e => setName(e.target.value)} placeholder="Наприклад, Монстера" className={inputCls} /></label>
      <label className="min-w-0 text-sm font-semibold">Вид рослини<select data-testid="select-plant-species" value={speciesId} onChange={e => setSpeciesId(e.target.value)} className={inputCls}><option value="">Оберіть вид</option>{(species.data ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <PlacePicker value={placeId} onChange={p => setPlaceId(p?.id ?? null)} />
      <div className="min-w-0 md:col-span-2">
        <label className="text-sm font-semibold">Погодна локація
          <select data-testid="select-plant-weather" value={weatherId ?? ""} onChange={e => setWeatherId(e.target.value ? Number(e.target.value) : null)} className={inputCls}>
            <option value="">Локація профілю за замовчуванням</option>
            {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.displayName}{l.isDefault ? " (основна)" : ""}</option>)}
          </select>
        </label>
        <button type="button" data-testid="button-toggle-location-search" onClick={() => setShowSearch(v => !v)} className="mt-2 text-sm font-semibold text-primary">{showSearch ? "Сховати пошук" : "Знайти іншу локацію"}</button>
        {showSearch && <div className="mt-3 rounded-xl bg-muted p-4"><LocationSearch onSaved={loc => { setWeatherId(loc.id); setShowSearch(false); }} /></div>}
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-muted p-3 text-xs leading-5 text-muted-foreground md:col-span-2" data-testid="notice-photo-unavailable">
        {photoUrl && <img src={photoUrl} alt={name || "Фото рослини"} className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
        <span className="flex items-start gap-2"><ImageOff size={14} className="mt-0.5 shrink-0" /> Завантаження фото тимчасово недоступне. {photoUrl ? "Поточне зображення збережеться без змін." : "Фото можна буде додати пізніше."}</span>
      </div>
      {error && <div className="md:col-span-2"><Alert>{error}</Alert></div>}
      <div className="flex gap-2 md:col-span-2"><Btn type="submit" disabled={pending} testId="button-save-plant">{pending ? "Зберігаємо…" : "Зберегти рослину"}</Btn><Btn variant="ghost" onClick={onCancel}>Скасувати</Btn></div>
    </form>
  </Pnl>;
}
