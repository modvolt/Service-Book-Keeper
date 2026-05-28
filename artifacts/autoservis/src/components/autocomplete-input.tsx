import { useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  maxSuggestions?: number;
}

export function AutocompleteInput({
  value,
  onChange,
  options,
  placeholder,
  required,
  disabled,
  className,
  maxSuggestions = 8,
}: AutocompleteInputProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listboxId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => o.toLowerCase().includes(q))
      : options;
    return matches
      .filter((o) => o.toLowerCase() !== q)
      .slice(0, maxSuggestions);
  }, [options, value, maxSuggestions]);

  function pick(opt: string) {
    onChange(opt);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (active >= 0 && active < suggestions.length) {
        e.preventDefault();
        pick(suggestions[active]!);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => { setOpen(false); setActive(-1); }, 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-activedescendant={active >= 0 ? `${listboxId}-opt-${active}` : undefined}
      />
      {open && suggestions.length > 0 && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full bg-popover border rounded-md shadow-md max-h-64 overflow-auto"
        >
          {suggestions.map((opt, i) => (
            <div
              id={`${listboxId}-opt-${i}`}
              key={opt}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(opt); }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${i === active ? "bg-accent" : "hover:bg-accent"}`}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
