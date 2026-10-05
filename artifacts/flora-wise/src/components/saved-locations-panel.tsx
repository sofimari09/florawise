import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Star, Trash2 } from "lucide-react";
import { getGetCurrentUserQueryKey, getGetDashboardQueryKey, getListSavedLocationsQueryKey, useDeleteSavedLocation, useListSavedLocations, useUpdateSavedLocation } from "@workspace/api-client-react";
import { Alert, Btn, Chip, Pnl, errMsg } from "./fw-ui";
import { LocationSearch } from "./location-search";

const fmtDate = (d: string) => new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "short" }).format(new Date(d));

export function SavedLocationsPanel() {
  const q = useQueryClient();
  const list = useListSavedLocations();
  const update = useUpdateSavedLocation();
  const remove = useDeleteSavedLocation();
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = () => Promise.all([
    q.invalidateQueries({ queryKey: getListSavedLocationsQueryKey() }),
    q.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }),
    q.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
  ]);
  const rename = (id: number) => {
    if (!name.trim()) { setError("Назва не може бути порожньою."); return; }
    setError("");
    update.mutate({ id, data: { displayName: name.trim() } }, { onSuccess: () => { setEditing(null); refresh(); }, onError: e => setError(errMsg(e, "Не вдалося перейменувати локацію.")) });
  };
  const makeDefault = (id: number) => {
    setError(""); setNotice("");
    update.mutate({ id, data: { isDefault: true } }, { onSuccess: () => { setNotice("Локацію за замовчуванням змінено."); refresh(); }, onError: e => setError(errMsg(e, "Не вдалося змінити локацію за замовчуванням.")) });
  };
  const del = (id: number, label: string) => {
    if (!window.confirm(`Видалити локацію «${label}»?`)) return;
    setError(""); setNotice("");
    remove.mutate({ id }, { onSuccess: () => refresh(), onError: e => setError(errMsg(e, "Локацію неможливо видалити, доки вона використовується.")) });
  };
  const items = list.data ?? [];
  return <Pnl className="p-6">
    <h2 className="font-serif text-2xl">Збережені локації</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Оберіть географічні локації для погоди. Позначена локація за замовчуванням застосовується до рослин без власної погодної локації. Координати підставляються автоматично.</p>
    <div className="mt-5 space-y-2">
      {list.isLoading && <div className="fw-skeleton h-16 rounded-xl" />}
      {list.error && <Alert>Не вдалося завантажити локації. Оновіть сторінку.</Alert>}
      {!list.isLoading && !list.error && items.length === 0 && <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Збережених локацій ще немає. Знайдіть місто нижче або скористайтеся визначенням місцезнаходження.</p>}
      {items.map(l => <div key={l.id} data-testid={`row-location-${l.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
        <MapPin size={17} className="text-primary" />
        {editing === l.id
          ? <><input data-testid="input-location-rename" value={name} onChange={e => setName(e.target.value)} className="min-w-[180px] flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm" /><Btn onClick={() => rename(l.id)} disabled={update.isPending}>Зберегти</Btn><Btn variant="ghost" onClick={() => setEditing(null)}>Скасувати</Btn></>
          : <><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{l.displayName}</p><p className="text-xs text-muted-foreground">Востаннє використано: {fmtDate(l.lastUsedAt)}</p></div>
            {l.isDefault ? <Chip tone="good">За замовчуванням</Chip> : <Btn variant="soft" onClick={() => makeDefault(l.id)} disabled={update.isPending} testId={`button-location-default-${l.id}`}><Star size={14} /> Зробити основною</Btn>}
            <Btn variant="ghost" onClick={() => { setEditing(l.id); setName(l.displayName); setError(""); }}><Pencil size={14} /></Btn>
            <Btn variant="danger" onClick={() => del(l.id, l.displayName)} testId={`button-location-delete-${l.id}`}><Trash2 size={14} /></Btn></>}
      </div>)}
    </div>
    {notice && <div className="mt-3"><Alert tone="good">{notice}</Alert></div>}
    {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    <div className="mt-6 border-t border-border pt-5"><h3 className="text-sm font-semibold">Додати локацію</h3><div className="mt-1"><LocationSearch makeDefault={items.length === 0} onSaved={() => { setNotice("Локацію збережено."); refresh(); }} /></div></div>
  </Pnl>;
}
