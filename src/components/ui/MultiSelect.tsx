import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, X } from "lucide-react";

interface Option { value: string; label: string }

interface MultiSelectProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
}

export function MultiSelect({ options, selected, onChange, placeholder = "Select..." }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (val: string) =>
    onChange(selected.includes(val) ? selected.filter(s => s !== val) : [...selected, val]);

  const allSelected = options.length > 0 && selected.length === options.length;
  const someSelected = selected.length > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      onChange([]); // deselect all
    } else {
      onChange(options.map(o => o.value)); // select all
    }
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px", border: "1px solid var(--line)", borderRadius: "6px",
          fontSize: "14px", backgroundColor: "var(--bg-elev-2)", color: "var(--text)",
          height: "38px", cursor: "pointer"
        }}
      >
        <span style={{ color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {selected.length === 0
            ? placeholder
            : allSelected
              ? "All selected"
              : `${selected.length} selected`}
        </span>
        <ChevronDown style={{ width: "16px", height: "16px", color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </button>

      {/* Selected pills */}
      {selected.length > 0 && !allSelected && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
          {selected.map(val => {
            const opt = options.find(o => o.value === val);
            return (
              <span key={val} style={{ display: "flex", alignItems: "center", gap: "4px", backgroundColor: "var(--accent-muted)", color: "var(--accent)", fontSize: "12px", padding: "2px 8px", borderRadius: "12px" }}>
                {opt?.label || val}
                <X style={{ width: "12px", height: "12px", cursor: "pointer" }} onClick={() => toggle(val)} />
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div style={{ position: "absolute", zIndex: 50, top: "42px", left: 0, width: "100%", backgroundColor: "var(--bg-elev-2)", border: "1px solid var(--line)", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", maxHeight: "240px", overflowY: "auto" }}>
          {options.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: "14px", color: "var(--text-muted)" }}>No options.</div>
          ) : (
            <>
              {/* Select All row */}
              <div
                onClick={toggleAll}
                style={{
                  display: "flex", alignItems: "center", padding: "8px 12px", fontSize: "14px",
                  cursor: "pointer", borderBottom: "2px solid var(--line)",
                  fontWeight: 600, color: "var(--text)", backgroundColor: "var(--bg-elev)",
                }}
              >
                <div style={{
                  width: "16px", height: "16px", borderRadius: "4px", marginRight: "8px",
                  border: allSelected || someSelected ? "1px solid var(--accent)" : "1px solid var(--line-heavy)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  backgroundColor: allSelected ? "var(--accent)" : someSelected ? "var(--accent-muted)" : "transparent",
                }}>
                  {allSelected && <Check style={{ width: "12px", height: "12px", color: "var(--bg-elev)" }} />}
                  {someSelected && <span style={{ width: "8px", height: "2px", backgroundColor: "var(--accent)", display: "block", borderRadius: "1px" }} />}
                </div>
                {allSelected ? "Deselect all" : "Select all"}
              </div>

              {/* Individual options */}
              {options.map(opt => {
                const isSelected = selected.includes(opt.value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => toggle(opt.value)}
                    style={{ display: "flex", alignItems: "center", padding: "8px 12px", fontSize: "14px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                  >
                    <div style={{ width: "16px", height: "16px", borderRadius: "4px", border: isSelected ? "1px solid var(--accent)" : "1px solid var(--line-heavy)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: "8px", backgroundColor: isSelected ? "var(--accent)" : "transparent" }}>
                      {isSelected && <Check style={{ width: "12px", height: "12px", color: "var(--bg-elev)" }} />}
                    </div>
                    {opt.label}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
