import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import {
  getGetDashboardQueryKey, getGetPlantQueryKey, getGetStatisticsQueryKey, getListPlantsQueryKey, getListRemindersQueryKey, getListTasksQueryKey,
  useConfirmCarePlan, usePreviewCarePlan, getPreviewCarePlanQueryKey,
} from "@workspace/api-client-react";
import type { CarePlanItem } from "@workspace/api-client-react";
import { Alert, Btn, Modal, careTypeLabel, errMsg, toDateInput } from "./fw-ui";

type Row = CarePlanItem & { selected: boolean };

export function CarePlanDialog({ plantId, plantName, onClose, onConfirmed }: { plantId: number; plantName: string; onClose: () => void; onConfirmed?: () => void }) {
  const q = useQueryClient();
  const preview = usePreviewCarePlan(plantId, { query: { queryKey: getPreviewCarePlanQueryKey(plantId), gcTime: 0, staleTime: 0, refetchOnWindowFocus: false } });
  const confirm = useConfirmCarePlan();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (preview.data && !preview.isFetching && !preview.isError && !loaded) { setRows(preview.data.map(i => ({ ...i, scheduledDate: toDateInput(i.scheduledDate), selected: true }))); setLoaded(true); }
  }, [preview.data, preview.isFetching, preview.isError, loaded]);
  const patch = (i: number, p: Partial<Row>) => setRows(r => r.map((x, k) => k === i ? { ...x, ...p } : x));
  const chosen = rows.filter(r => r.selected);
  const submit = () => {
    setError("");
    if (!chosen.length) { setError("Оберіть хоча б один пункт плану."); return; }
    if (chosen.some(r => !r.scheduledDate)) { setError("Вкажіть дату для кожного обраного пункту."); return; }
    if (chosen.length > 10) { setError("Можна підтвердити щонайбільше 10 пунктів."); return; }
    confirm.mutate({ id: plantId, data: { items: chosen.map(({ type, scheduledDate, reason, eligibilityVersion }) => ({ type, scheduledDate, reason, eligibilityVersion })) } }, {
      onSuccess: async () => {
        await Promise.all([
          q.invalidateQueries({ queryKey: getListTasksQueryKey() }), q.invalidateQueries({ queryKey: getListRemindersQueryKey() }),
          q.invalidateQueries({ queryKey: getGetStatisticsQueryKey() }), q.invalidateQueries({ queryKey: getGetDashboardQueryKey() }),
          q.invalidateQueries({ queryKey: getGetPlantQueryKey(plantId) }), q.invalidateQueries({ queryKey: getListPlantsQueryKey() }),
        ]);
        onConfirmed?.(); onClose();
      },
      onError: e => { setError(errMsg(e, "Не вдалося підтвердити план догляду.")); setLoaded(false); setRows([]); preview.refetch(); },
    });
  };
  return <Modal title={`План догляду: ${plantName}`} onClose={onClose} wide>
    <p className="mb-4 text-sm leading-6 text-muted-foreground">Пропозиції можливі лише за наявності підтвердженого інтервалу догляду. Для рослини поза довідником категорія визначає доступні дії, але не частоту догляду. Нічого не буде створено, доки ви не підтвердите обрані пункти та дати.</p>
    {preview.isLoading && <div className="space-y-2"><div className="fw-skeleton h-16 rounded-xl" /><div className="fw-skeleton h-16 rounded-xl" /></div>}
    {preview.error && <Alert>Не вдалося підготувати план. <button type="button" className="font-semibold underline" onClick={() => preview.refetch()}>Повторити</button></Alert>}
    {loaded && rows.length === 0 && <p role="status" className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Немає підтверджених інтервалів для нового плану або відповідний догляд уже заплановано. Частоту й дати не припущено. Перевірте стан рослини та додайте потрібне завдання вручну в календарі.</p>}
    <div className="space-y-2">{rows.map((r, i) => <div key={i} data-testid={`row-care-plan-${i}`} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${r.selected ? "border-primary/40 bg-primary/5" : "border-border"}`}>
      <input type="checkbox" aria-label={`обрати ${careTypeLabel[r.type] || r.type}`} data-testid={`checkbox-care-plan-${i}`} checked={r.selected} onChange={e => patch(i, { selected: e.target.checked })} className="h-4 w-4 accent-primary" />
      <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{careTypeLabel[r.type] || careTypeLabel[r.type.toUpperCase()] || r.type}</p><p className="text-xs leading-5 text-muted-foreground">{r.reason}</p></div>
      <input type="date" aria-label="дата" data-testid={`input-care-plan-date-${i}`} disabled={!r.selected} value={r.scheduledDate} onChange={e => patch(i, { scheduledDate: e.target.value })} className="rounded-xl border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" />
    </div>)}</div>
    {error && <div className="mt-4"><Alert>{error}</Alert></div>}
    <div className="mt-5 flex flex-wrap justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Пізніше</Btn><Btn onClick={submit} disabled={confirm.isPending || preview.isFetching || preview.isError || !loaded || !chosen.length} testId="button-confirm-care-plan"><CalendarCheck size={16} /> {confirm.isPending ? "Створюємо…" : `Підтвердити (${chosen.length})`}</Btn></div>
  </Modal>;
}
