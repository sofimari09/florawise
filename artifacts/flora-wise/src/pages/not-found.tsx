import { Link } from 'wouter';
import { ArrowLeft, Leaf } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="fw-noise flex min-h-[100dvh] w-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-3xl border border-card-border bg-card p-8 text-center shadow-xl">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-accent text-foreground"><Leaf size={26} /></span>
        <p className="mt-7 font-mono text-[10px] uppercase tracking-[.2em] text-primary">FloraWise / 404</p>
        <h1 className="mt-3 font-serif text-4xl">Цієї сторінки немає</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Схоже, посилання повело вас трохи не туди. Повернімося до вашого простору.</p>
        <Link href="/" data-testid="link-not-found-home" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"><ArrowLeft size={16} /> На головну</Link>
      </div>
    </div>
  );
}
