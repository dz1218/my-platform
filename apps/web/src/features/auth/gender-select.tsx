"use client";

import { useEffect, useRef, useState } from "react";
import type { Gender } from "@/types/companion";

const options = [
  { value: "FEMALE", label: "女" },
  { value: "MALE", label: "男" },
] satisfies { value: Gender; label: string }[];

export function GenderSelect({
  id = "register-gender",
  describedBy = "register-gender-help",
  value: controlledValue,
  onChange,
  disabled = false,
}: {
  id?: string;
  describedBy?: string;
  value?: Gender | "";
  onChange?: (value: Gender) => void;
  disabled?: boolean;
} = {}) {
  const [internalValue, setInternalValue] = useState<Gender | "">("");
  const value = controlledValue ?? internalValue;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = options.findIndex((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function expand(index = Math.max(selected, 0)) {
    const rect = trigger.current?.getBoundingClientRect();
    setAbove(!!rect && window.innerHeight - rect.bottom < 112 && rect.top > 112);
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    if (disabled) return;
    updateValue(options[index].value);
    setInvalid(false);
    setOpen(false);
    trigger.current?.focus();
  }

  function updateValue(nextValue: Gender) {
    setInternalValue(nextValue);
    onChange?.(nextValue);
    setInvalid(false);
  }

  return (
    <div ref={root} className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <select
        name="gender"
        required
        disabled={disabled}
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => updateValue(event.target.value as Gender)}
        onInvalid={(event) => {
          event.preventDefault();
          setInvalid(true);
          trigger.current?.focus();
        }}
      >
        <option value="" disabled>请选择性别</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button
        ref={trigger}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={`${id}-options`}
        aria-activedescendant={open && !disabled ? `${id}-option-${active}` : undefined}
        aria-required="true"
        aria-invalid={invalid || undefined}
        aria-describedby={[describedBy, invalid ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined}
        className="input-field select-trigger"
        onClick={() => open ? setOpen(false) : expand()}
        onKeyDown={(event) => {
          switch (event.key) {
            case "ArrowDown":
            case "ArrowUp":
              event.preventDefault();
              if (!open) expand(selected < 0 && event.key === "ArrowUp" ? options.length - 1 : Math.max(selected, 0));
              else setActive((current) => Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
              break;
            case "Home":
            case "End":
              event.preventDefault();
              expand(event.key === "Home" ? 0 : options.length - 1);
              break;
            case "Enter":
            case " ":
              event.preventDefault();
              if (open) choose(active);
              else expand();
              break;
            case "Escape":
              if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
              break;
            case "Tab":
              setOpen(false);
              break;
            default: {
              const index = options.findIndex((option) => option.label === event.key);
              if (index >= 0) { event.preventDefault(); if (open) setActive(index); else choose(index); }
            }
          }
        }}
      >
        <span className={value ? undefined : "text-slate-500"}>{options[selected]?.label ?? "请选择性别"}</span>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-muted">
          <path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && !disabled && (
        <ul id={`${id}-options`} role="listbox" aria-label="性别" className={`select-menu ${above ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={value === option.value}
              data-active={active === index}
              className="select-option"
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.label}
              {value === option.value && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </li>
          ))}
        </ul>
      )}
      {invalid && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-rose-700">请选择性别。</p>}
    </div>
  );
}
