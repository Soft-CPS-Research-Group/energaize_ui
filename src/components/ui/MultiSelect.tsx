import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";

interface Option { value: string; label: string }

interface MultiSelectProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

/**
 * Dropdown of checkboxes: keyboard reachable (Tab/Space), Escape closes it,
 * and each selected value appears as a removable chip.
 */
export function MultiSelect({ options, selected, onChange, placeholder = "Select..." }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val]);

  const allSelected = options.length > 0 && selected.length === options.length;
  const someSelected = selected.length > 0 && !allSelected;

  const summary = selected.length === 0
    ? placeholder
    : allSelected ? "All selected" : `${selected.length} selected`;

  return (
    <div ref={ref} className="multiselect">
      <button
        ref={triggerRef}
        type="button"
        className="multiselect-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(o => !o)}
      >
        <span className={selected.length === 0 ? "multiselect-placeholder" : undefined}>{summary}</span>
        <ChevronDown size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
      </button>

      {someSelected && (
        <ul className="multiselect-chips" aria-label="Selected">
          {selected.map(val => {
            const label = options.find(o => o.value === val)?.label || val;
            return (
              <li key={val}>
                {label}
                <button type="button" onClick={() => toggle(val)} aria-label={`Remove ${label}`}>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <div className="multiselect-menu" id={listId} role="group" aria-label={placeholder}>
          {options.length === 0 ? (
            <p className="multiselect-empty">No options.</p>
          ) : (
            <>
              <label className="multiselect-option multiselect-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={() => onChange(allSelected ? [] : options.map(o => o.value))}
                />
                {allSelected ? "Deselect all" : "Select all"}
              </label>
              {options.map(opt => (
                <label key={opt.value} className="multiselect-option">
                  <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
