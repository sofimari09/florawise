import { useEffect, useId, useRef, useState } from "react";
import { getListSpeciesQueryKey, useListSpecies } from "@workspace/api-client-react";
import type { PlantSpecies } from "@workspace/api-client-react";
import { Leaf, X } from "lucide-react";
import { inputCls } from "./fw-ui";
import { speciesKeyAction, speciesSearchKey } from "./species-search-state";

export function SpeciesPicker({ value, initialName = "", onChange, disabled }: {
  value: PlantSpecies | null;
  initialName?: string;
  onChange: (species: PlantSpecies | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialName);
  const [search, setSearch] = useState(speciesSearchKey(initialName));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const key = speciesSearchKey(text);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(key), 180);
    return () => clearTimeout(timer);
  }, [key]);
  useEffect(() => { if (value) setText(value.name); }, [value]);
  const query = useListSpecies({ search }, { query: { queryKey: getListSpeciesQueryKey({ search }), staleTime: 60_000, retry: false, enabled: open } });
  const waiting = key !== search || query.isFetching || query.isLoading;
  const results = waiting || query.isError ? [] : query.data ?? [];
  useEffect(() => { setActive(-1); }, [search, query.data]);
  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  const choose = (species: PlantSpecies) => {
    onChange(species); setText(species.name); setSearch(speciesSearchKey(species.name));
    setOpen(false); setActive(-1); input.current?.focus();
  };
  const edit = (next: string) => {
    setText(next); onChange(null); setActive(-1); setOpen(true);
  };
  return <div className="min-w-0 md:col-span-2">
    <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <label htmlFor={id} className="text-sm font-semibold">Рослина</label>
      <div className="relative">
        <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 && results[active] ? `${id}-option-${active}` : undefined}
          aria-describedby={`${id}-help`} autoComplete="off" value={text} disabled={disabled}
          data-testid="input-plant-species" placeholder="Почніть вводити назву..." className={`${inputCls} pr-12`}
          onFocus={() => setOpen(true)} onChange={e => edit(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return;
            const next = speciesKeyAction(e.key, active, results.length, open);
            if (next.prevent) { e.preventDefault(); e.stopPropagation(); }
            setOpen(next.open); setActive(next.active);
            if (next.select !== undefined) choose(results[next.select]);
          }} />
        {text && <button type="button" aria-label="Очистити вибір рослини" disabled={disabled} data-testid="button-clear-species"
          className="absolute right-3 top-1/2 text-muted-foreground" onClick={() => { edit(""); input.current?.focus(); }}><X size={18} /></button>}
      </div>
      {open && <div className="absolute z-30 mt-1 w-full rounded-xl border border-border bg-card p-2 shadow-lg">
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {waiting ? "Шукаємо рослини…" : query.isError ? "Не вдалося завантажити рослини." : results.length === 0 ? "Нічого не знайдено. Спробуйте іншу назву з довідника." : `${results.length} варіантів у довіднику`}
        </p>
        {query.isError && <button type="button" className="my-2 text-sm font-semibold text-primary" onClick={() => query.refetch()}>Повторити пошук</button>}
        <ul id={`${id}-list`} role="listbox" aria-label="Рослини з довідника" className="max-h-60 overflow-y-auto">
          {results.map((species, index) => <li key={species.id} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
            onPointerDown={e => e.preventDefault()}
            onClick={() => choose(species)} onMouseMove={() => setActive(index)}
            className={`cursor-pointer rounded-lg px-3 py-3 text-sm ${active === index ? "bg-secondary text-primary" : "hover:bg-muted"}`}
            data-testid={`option-species-${species.id}`}>
            <span className="font-semibold">{species.name}</span>{species.scientificName && <span className="ml-2 text-xs text-muted-foreground">{species.scientificName}</span>}
          </li>)}
        </ul>
      </div>}
    </div>
    <p id={`${id}-help`} className="mt-2 text-xs text-muted-foreground">Оберіть рослину з довідника. Введений текст без вибору не визначає вид.</p>
    {value && <div data-testid="preview-selected-species" className="mt-3 flex items-center gap-4 rounded-xl bg-muted p-4">
      {value.imageUrl && failedImage !== value.imageUrl
        ? <img src={value.imageUrl} alt={value.name} onError={() => setFailedImage(value.imageUrl)} className="h-20 w-20 rounded-lg object-cover" />
        : <div className="grid h-20 w-20 shrink-0 place-items-center rounded-lg bg-secondary text-primary" aria-label="Фото виду відсутнє"><Leaf size={26} /></div>}
      <div><p className="text-xs text-muted-foreground">Вид із довідника</p><p className="font-semibold">{value.name}</p>
        {value.scientificName && <p className="text-sm italic">{value.scientificName}</p>}
        <p data-testid="text-species-category" className="mt-1 text-sm text-muted-foreground">{value.category?.trim() ? `Категорія: ${value.category}` : "Категорію не вказано"}</p>
      </div>
    </div>}
  </div>;
}
