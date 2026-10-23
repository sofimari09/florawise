import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateTask, useGetPlant, useListPlants, getGetPlantQueryKey } from "@workspace/api-client-react";
import { isCareType } from "@workspace/plant-care";
import { Alert, Btn, careTypeLabel, errMsg, inputCls } from "./fw-ui";

export function TaskCreateForm({ onDone }: { onDone: () => void }) {
  const q = useQueryClient();
  const plants = useListPlants();
  const create = useCreateTask();
  const [form, setForm] = useState({ plantId: "", type: "", scheduledDate: new Date().toISOString().slice(0, 10), notes: "" });
  const [urgentOverride, setUrgentOverride] = useState(false);
  const [error, setError] = useState("");
  const selected = useGetPlant(Number(form.plantId), { query: {
    queryKey: getGetPlantQueryKey(Number(form.plantId)), enabled: !!form.plantId, staleTime: 0, retry: false,
  } });
  // Cached data is never used while a fresh applicability request is in progress or has failed.
  const ready = !!form.plantId && !selected.isFetching && !selected.isError && selected.data?.id === Number(form.plantId);
  const allowed = ready ? selected.data?.allowedCareTypes ?? [] : [];
  const valid = isCareType(form.type) && allowed.includes(form.type);
  useEffect(() => {
    if (ready && form.type && !allowed.includes(form.type as typeof allowed[number])) setForm(value => ({ ...value, type: "" }));
  }, [ready, selected.data, form.type]);
  const submit = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    if (!ready || !valid || !isCareType(form.type)) return;
    setError("");
    create.mutate({ data: { ...form, plantId: Number(form.plantId), type: form.type, priority: urgentOverride ? "URGENT" : "MEDIUM" } }, {
      onSuccess: async () => { await q.invalidateQueries(); onDone(); },
      onError: err => { setError(errMsg(err, "Не вдалося створити завдання.")); selected.refetch(); },
    });
  };
  return <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
    <label>Рослина<select required aria-label="Рослина для завдання" data-testid="select-task-plant" value={form.plantId}
      onChange={e => { setError(""); setForm({ ...form, plantId: e.target.value, type: "" }); }} className={inputCls}>
      <option value="">Оберіть рослину</option>{(plants.data ?? []).map(plant => <option key={plant.id} value={plant.id}>{plant.name}</option>)}
    </select></label>
    <label>Тип догляду<select required aria-label="Тип догляду" data-testid="select-task-type" value={valid ? form.type : ""} disabled={!ready || !allowed.length}
      onChange={e => setForm({ ...form, type: e.target.value })} className={inputCls}>
      <option value="">Оберіть тип догляду</option>{allowed.map(type => <option key={type} value={type}>{careTypeLabel[type]}</option>)}
    </select></label>
    {plants.isLoading && <p role="status">Завантажуємо рослини…</p>}
    {plants.isError && <Alert>Не вдалося завантажити рослини. <button type="button" onClick={() => plants.refetch()}>Повторити</button></Alert>}
    {form.plantId && selected.isFetching && <p role="status">Перевіряємо застосовні дії…</p>}
    {selected.isError && <Alert>Не вдалося перевірити застосовність. <button type="button" onClick={() => selected.refetch()}>Повторити</button></Alert>}
    {ready && !allowed.length && <p role="status">Для цього виду немає застосовних дій догляду.</p>}
    <label>Дата<input required data-testid="input-task-date" type="date" value={form.scheduledDate} onChange={e => setForm({ ...form, scheduledDate: e.target.value })} className={inputCls} /></label>
    <div className="md:col-span-2 rounded-xl border border-border/70 bg-muted/30 p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={urgentOverride} onChange={e => setUrgentOverride(e.target.checked)} />
        Термінове завдання — виняток із розрахованого пріоритету
      </label>
      <p className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">
        Для звичайних завдань рівень визначається автоматично за строком, інтервалом догляду та доречною для рослини погодою.
      </p>
    </div>
    <label className="md:col-span-2">Нотатка<input data-testid="input-task-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} /></label>
    {error && <Alert>{error}</Alert>}
    <Btn type="submit" disabled={create.isPending || !ready || !valid} className="md:col-span-2">{create.isPending ? "Зберігаємо…" : "Додати до календаря"}</Btn>
  </form>;
}
