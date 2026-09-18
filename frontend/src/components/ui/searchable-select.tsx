import { useId, useRef, useState } from 'react';
import { inputClassName } from './input';

type Option = { value: string; label: string; searchText: string };

export function SearchableSelect({ label, value, options, onChange, normalizeSearch, disabled, placeholder, error }: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  normalizeSearch: (value: string) => string;
  disabled?: boolean;
  placeholder: string;
  error?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const filtered = options.filter((option) => normalizeSearch(option.searchText).includes(normalizeSearch(query)));
  const choose = (option: Option) => {
    onChange(option.value);
    setOpen(false);
    setQuery('');
  };
  const move = (next: number) => {
    const index = Math.max(0, Math.min(filtered.length - 1, next));
    setActive(index);
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">{label}</label>
      <div className="relative">
        <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && !disabled}
          aria-controls={`${id}-list`} aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          autoComplete="off" disabled={disabled} placeholder={placeholder} className={`${inputClassName} pr-10`}
          value={open ? query : selected?.label ?? ''}
          onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
          onClick={() => setOpen(true)}
          onBlur={() => { setOpen(false); setQuery(''); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true); move(active + (event.key === 'ArrowDown' ? 1 : -1));
            }
            if (event.key === 'Enter' && open) {
              event.preventDefault();
              if (filtered[active]) choose(filtered[active]);
            }
          }} />
        <span aria-hidden="true" className="pointer-events-none absolute right-3 top-3 text-muted-foreground">▾</span>
      </div>
      {open && !disabled && <ul id={`${id}-list`} role="listbox" aria-label={label}
        className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-control border border-border bg-surface p-1 shadow-surface">
        {filtered.map((option, index) => <li key={option.value} id={`${id}-option-${index}`} role="option"
          aria-selected={option.value === value} onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(option)}
          className={`min-h-11 cursor-pointer break-words rounded-control px-3 py-3 text-sm text-ink ${index === active ? 'bg-primary-soft' : 'hover:bg-surface-subtle'}`}>
          {option.label}
        </li>)}
        {!filtered.length && <li role="presentation" className="p-3 text-sm text-muted-foreground">Không tìm thấy. Thử tên khác hoặc bỏ dấu.</li>}
      </ul>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}
