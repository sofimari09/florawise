import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { requestPhotoUpload, completePhotoUpload, getGetPlantQueryKey, getListPlantsQueryKey, getListSpeciesQueryKey, useCreatePlant, useListPlantPlaces, useListSavedLocations, useListSpecies, useUpdatePlant } from "@workspace/api-client-react";
import type { Plant, PlantInput, PlantSpecies } from "@workspace/api-client-react";
import { Alert, Btn, Pnl, errMsg, inputCls } from "./fw-ui";
import { PlacePicker } from "./place-picker";
import { LocationSearch } from "./location-search";
import { PlantPhoto } from "./plant-photo";
import { SpeciesPicker } from "./species-picker";

export function PlantForm({ plant, onDone, onCancel }: { plant?: Plant | null; onDone: (plant: Plant, created: boolean) => void; onCancel: () => void }) {
  const q = useQueryClient();
  const species = useListSpecies(undefined, { query: { queryKey: getListSpeciesQueryKey(), enabled: !!plant, staleTime: 60_000, retry: false } });
  const places = useListPlantPlaces();
  const locations = useListSavedLocations();
  const create = useCreatePlant();
  const update = useUpdatePlant();
  const [name, setName] = useState(plant?.personalName ?? "");
  const [selectedSpecies, setSelectedSpecies] = useState<PlantSpecies | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (plant && species.data && !initialized.current) {
      setSelectedSpecies(species.data.find(s => s.id === plant.speciesId) ?? null);
      initialized.current = true;
    }
  }, [plant, species.data]);
  const [placeId, setPlaceId] = useState<number | null>(plant?.placeId ?? null);
  const [weatherId, setWeatherId] = useState<number | null>(plant?.weatherLocationId ?? null);
  const [weatherChanged, setWeatherChanged] = useState(false);
  const { getToken, isSignedIn } = useAuth();
  const [photoObjectPath, setPhotoObjectPath] = useState(plant?.photoObjectPath ?? null);
  const [photoUrl, setPhotoUrl] = useState(plant?.photoObjectPath ? "" : plant?.photoUrl ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const busy = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const [showSearch, setShowSearch] = useState(false);
  const [error, setError] = useState("");
  const pending = uploading || create.isPending || update.isPending;

  const submit = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (busy.current || pending) return;
    setError("");
    if (!selectedSpecies) { setError("Оберіть рослину з довідника."); return; }
    const place = (places.data ?? []).find(p => p.id === placeId);
    if (!plant && !place) { setError("Оберіть або створіть місце вирощування."); return; }
    const weather = (locations.data ?? []).find(l => l.id === weatherId);
    const data: PlantInput = {
      personalName: name.trim() || null,
      speciesId: selectedSpecies.id,
      location: place?.name ?? plant?.location ?? "",
      environmentType: place?.environmentType ?? plant?.environmentType,
      photoUrl,
      photoObjectPath,
      weatherLocationId: weatherId,
      weatherLocationName: weather?.displayName ?? null,
      weatherLatitude: weather?.latitude ?? null,
      weatherLongitude: weather?.longitude ?? null,
    };
    // An untouched legacy coordinate override must not be cleared by this form.
    if (plant && !weatherChanged) {
      delete data.weatherLocationId;
      delete data.weatherLocationName;
      delete data.weatherLatitude;
      delete data.weatherLongitude;
    }
    if (place) data.placeId = place.id;
    if (!data.location) { setError("Оберіть місце вирощування."); return; }
    const fail = (e: unknown) => setError(errMsg(e, "Не вдалося зберегти рослину. Перевірте дані й спробуйте ще раз."));
    busy.current = true;
    setUploading(true);
    try {
      if (file) {
        const token = await getToken();
        if (!token) { setError("Увійдіть у свій акаунт, щоб завантажити фото."); return; }
        const options = { headers: { Authorization: `Bearer ${token}` } };
        const upload = await requestPhotoUpload({ name: file.name, size: file.size, contentType: file.type as "image/jpeg" | "image/png" | "image/webp" }, options);
        const response = await fetch(upload.uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) { setError("Не вдалося завантажити фото. Перевірте з’єднання й спробуйте ще раз."); return; }
        const completed = await completePhotoUpload({ objectPath: upload.objectPath }, options);
        data.photoObjectPath = completed.objectPath;
        data.photoUrl = "";
        setPhotoObjectPath(completed.objectPath);
        setPhotoUrl("");
        setFile(null);
      }
      const saved = plant ? await update.mutateAsync({ id: plant.id, data }) : await create.mutateAsync({ data });
      q.invalidateQueries({ queryKey: getListPlantsQueryKey() });
      if (plant) q.invalidateQueries({ queryKey: getGetPlantQueryKey(plant.id) });
      // Names are also embedded in task, reminder, history and advice responses.
      q.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" && /^\/api\/(tasks|reminders|history|recommendations|dashboard|statistics)(\/|$)/.test(query.queryKey[0]) });
      onDone(saved, !plant);
    } catch (e) { fail(e); }
    finally { busy.current = false; setUploading(false); }
  };

  return <Pnl className="mb-6 p-6">
    <h2 className="mb-5 font-serif text-2xl">{plant ? "Редагувати рослину" : "Нова рослина"}</h2>
    <form onSubmit={submit} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
      <SpeciesPicker value={selectedSpecies} initialName={plant?.speciesName} disabled={pending} onChange={s => { initialized.current = true; setSelectedSpecies(s); }} />
      {plant && species.isError && !initialized.current && <p role="alert" className="text-sm md:col-span-2">Не вдалося завантажити збережений вид. <button type="button" className="font-semibold text-primary" onClick={() => species.refetch()}>Повторити</button></p>}
      <div className="min-w-0 md:col-span-2">
        <label className="text-sm font-semibold">Власна назва (необов’язково)<input data-testid="input-plant-name" value={name} disabled={pending} onChange={e => setName(e.target.value)} placeholder="Наприклад, Малина біля паркану" className={inputCls} /></label>
        <p className="mt-2 text-xs text-muted-foreground">Це лише ваша назва. Вид і догляд визначаються вибором із довідника. Без власної назви використовуємо назву виду.</p>
      </div>
      <PlacePicker value={placeId} required={!plant?.location} onChange={p => setPlaceId(p?.id ?? null)} />
      <div className="min-w-0 md:col-span-2">
        <label className="text-sm font-semibold">Погодна локація
          <select data-testid="select-plant-weather" value={weatherId ?? ""} onChange={e => { setWeatherChanged(true); setWeatherId(e.target.value ? Number(e.target.value) : null); }} className={inputCls}>
            <option value="">Локація профілю за замовчуванням</option>
            {(locations.data ?? []).map(l => <option key={l.id} value={l.id}>{l.displayName}{l.isDefault ? " (основна)" : ""}</option>)}
          </select>
        </label>
        <button type="button" data-testid="button-toggle-location-search" onClick={() => setShowSearch(v => !v)} className="mt-2 text-sm font-semibold text-primary">{showSearch ? "Сховати пошук" : "Знайти іншу локацію"}</button>
        {showSearch && <div className="mt-3 rounded-xl bg-muted p-4"><LocationSearch onSaved={loc => { setWeatherChanged(true); setWeatherId(loc.id); setShowSearch(false); }} /></div>}
      </div>
      <div className="min-w-0 rounded-xl bg-muted p-4 md:col-span-2">
        <label className="text-sm font-semibold">Фото рослини
          <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" disabled={pending} data-testid="input-plant-photo" className={inputCls} onChange={e => {
            const selected = e.target.files?.[0];
            if (!selected) return;
            if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size < 1 || selected.size > 5 * 1024 * 1024) {
              setError("Оберіть JPEG, PNG або WebP розміром до 5 МБ."); e.target.value = ""; return;
            }
            if (!isSignedIn) { setError("Увійдіть у свій акаунт, щоб завантажити фото."); e.target.value = ""; return; }
            setError(""); setFile(selected);
          }} />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">JPEG, PNG або WebP, до 5 МБ. Фото доступне лише вам.</p>
        {(preview || photoObjectPath || photoUrl) && <div className="mt-3 flex items-center gap-3">
          <PlantPhoto src={preview || (photoObjectPath ? `/api/storage${photoObjectPath}` : photoUrl)} alt={name || selectedSpecies?.name || "Фото рослини"} className="h-24 w-24 rounded-lg object-cover" />
          <Btn variant="ghost" disabled={pending} testId="button-remove-plant-photo" onClick={() => { setFile(null); setPhotoObjectPath(null); setPhotoUrl(""); if (picker.current) picker.current.value = ""; }}>Прибрати фото</Btn>
        </div>}
        {uploading && <p role="status" className="mt-2 text-sm">Завантажуємо фото та зберігаємо рослину…</p>}
      </div>
      {error && <div className="md:col-span-2"><Alert>{error}</Alert></div>}
      <div className="flex gap-2 md:col-span-2"><Btn type="submit" disabled={pending} testId="button-save-plant">{pending ? "Зберігаємо…" : "Зберегти рослину"}</Btn><Btn variant="ghost" disabled={pending} onClick={onCancel}>Скасувати</Btn></div>
    </form>
  </Pnl>;
}
