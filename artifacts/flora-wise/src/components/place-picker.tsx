import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { getGetDashboardQueryKey, getListPlantsQueryKey, getListPlantPlacesQueryKey, useCreatePlantPlace, useDeletePlantPlace, useListPlantPlaces, useUpdatePlantPlace } from "@workspace/api-client-react";
import type { PlantPlace, PlantPlaceInput } from "@workspace/api-client-react";
import { Alert, Btn, environmentOptions, envLabel, errMsg, inputCls } from "./fw-ui";

type Env = PlantPlaceInput["environmentType"];

export function PlacePicker({ value, onChange }: { value: number | null; onChange: (place: PlantPlace | null) => void }) {
  const q = useQueryClient();
  const places = useListPlantPlaces();
  const create = useCreatePlantPlace();
  const update = useUpdatePlantPlace();
  const remove = useDeletePlantPlace();
  const [mode, setMode] = useState<"idle" | "new" | "edit">("idle");
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Env>("INDOOR");
  const [error, setError] = useState("");
  const list = places.data ?? [];
  const selected = list.find(p => p.id === value) ?? null;
  const refresh = () => Promise.all([
    q.invalidateQueries({ queryKey: getListPlantPlacesQueryKey() }),
    q.invalidateQueries({ queryKey: getListPlantsQueryKey() }),
    q.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
    q.invalidateQueries({ predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/plants/") }),
  ]);

  const open = (m: "new" | "edit") => {
    setError("");
    setMode(m);
    setName(m === "edit" && selected ? selected.name : "");
    setEnv(m === "edit" && selected ? selected.environmentType : "INDOOR");
  };
  const save = () => {
    const data = { name: name.trim(), environmentType: env };
    if (!data.name) { setError("Вкажіть назву місця."); return; }
    setError("");
    if (mode === "edit" && selected) {
      update.mutate({ id: selected.id, data }, { onSuccess: place => { refresh(); onChange(place); setMode("idle"); }, onError: e => setError(errMsg(e, "Не вдалося оновити місце.")) });
    } else {
      create.mutate({ data }, { onSuccess: place => { refresh(); onChange(place); setMode("idle"); }, onError: e => setError(errMsg(e, "Не вдалося створити місце.")) });
    }
  };
  const del = () => {
    if (!selected || !window.confirm(`Видалити місце «${selected.name}»?`)) return;
    setError("");
    remove.mutate({ id: selected.id }, { onSuccess: () => { refresh(); onChange(null); }, onError: e => setError(errMsg(e, "Місце неможливо видалити, доки воно використовується рослинами.")) });
  };

  return <div className="min-w-0 md:col-span-2">
    <span className="text-sm font-semibold">Місце вирощування</span>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select required data-testid="select-plant-place" value={value ?? ""} onChange={e => onChange(list.find(p => p.id === Number(e.target.value)) ?? null)} className="min-w-[220px] flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm">
        <option value="">{places.isLoading ? "Завантаження…" : "Оберіть місце"}</option>
        {list.map(p => <option key={p.id} value={p.id}>{p.name} · {envLabel[p.environmentType]}</option>)}
      </select>
      <Btn variant="soft" onClick={() => open("new")} testId="button-place-new"><Plus size={15} /> Нове місце</Btn>
      {selected && <><Btn variant="ghost" onClick={() => open("edit")} testId="button-place-edit"><Pencil size={15} /></Btn><Btn variant="danger" onClick={del} disabled={remove.isPending} testId="button-place-delete"><Trash2 size={15} /></Btn></>}
    </div>
    {places.error && <div className="mt-2"><Alert>Не вдалося завантажити місця. Оновіть сторінку.</Alert></div>}
    {mode !== "idle" && <div className="mt-3 grid gap-3 rounded-xl bg-muted p-4 sm:grid-cols-[1fr_200px_auto]">
      <label className="text-sm font-semibold">Назва<input data-testid="input-place-name" value={name} onChange={e => setName(e.target.value)} placeholder="Наприклад, вітальня" className={inputCls} /></label>
      <label className="text-sm font-semibold">Середовище<select data-testid="select-place-env" value={env} onChange={e => setEnv(e.target.value as Env)} className={inputCls}>{environmentOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      <div className="flex items-end gap-1"><Btn onClick={save} disabled={create.isPending || update.isPending} testId="button-place-save"><Check size={15} /> Зберегти</Btn><Btn variant="ghost" onClick={() => setMode("idle")}><X size={15} /></Btn></div>
    </div>}
    {error && <div className="mt-2"><Alert>{error}</Alert></div>}
  </div>;
}
