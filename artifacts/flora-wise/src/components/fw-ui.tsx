import type { ReactNode } from "react";
import { CircleAlert, X } from "lucide-react";

export const inputCls = "mt-2 w-full min-w-0 max-w-full rounded-xl border border-input bg-background px-4 py-3 text-sm font-normal outline-none focus:ring-4 focus:ring-primary/10";
export const environmentOptions = [
  { value: "INDOOR", label: "У приміщенні" },
  { value: "BALCONY", label: "Балкон" },
  { value: "OUTDOOR", label: "Надворі" },
  { value: "GREENHOUSE", label: "Теплиця" },
] as const;
export const envLabel: Record<string, string> = Object.fromEntries(environmentOptions.map(o => [o.value, o.label]));
export const careTypeLabel: Record<string, string> = { WATERING: "Полив", FERTILIZING: "Підживлення", PRUNING: "Обрізка", TRANSPLANTING: "Пересадка", TREATMENT: "Обробка", HARVEST: "Збір урожаю", OTHER: "Догляд" };

export function errMsg(error: unknown, fallback: string): string {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const k of ["error", "message", "detail"]) if (typeof d[k] === "string" && d[k]) return d[k] as string;
  }
  return fallback;
}

type Variant = "primary" | "soft" | "ghost" | "danger";
export function Btn({ children, onClick, variant = "primary", className = "", disabled, type = "button", testId }: { children: ReactNode; onClick?: () => void; variant?: Variant; className?: string; disabled?: boolean; type?: "button" | "submit"; testId?: string }) {
  const styles = { primary: "bg-primary text-primary-foreground hover:opacity-90", soft: "bg-secondary text-secondary-foreground hover:bg-accent", ghost: "text-muted-foreground hover:bg-muted hover:text-foreground", danger: "text-destructive hover:bg-destructive/10" };
  return <button data-testid={testId} type={type} disabled={disabled} onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}>{children}</button>;
}
export function Pnl({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-card-border bg-card shadow-[0_10px_30px_hsl(154_25%_18%_/.04)] ${className}`}>{children}</section>;
}
export function Chip({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  const tones = { neutral: "bg-muted text-muted-foreground", good: "bg-primary/10 text-primary", warn: "bg-accent/25 text-foreground", danger: "bg-destructive/10 text-destructive" };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
export function Alert({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "good" }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2 rounded-xl p-3 text-sm ${tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}><CircleAlert size={16} className="mt-0.5 shrink-0" /><span>{children}</span></div>;
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-foreground/30 p-4 md:p-10" role="dialog" aria-modal="true" aria-label={title}>
    <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-2xl border border-card-border bg-card p-6 shadow-2xl`}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="font-serif text-2xl">{title}</h2><button type="button" aria-label="закрити" data-testid="button-close-modal" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted"><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}
export const toDateInput = (d?: string | null) => d ? d.slice(0, 10) : "";
