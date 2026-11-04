"use client";

import { useId } from "react";
import type { Option } from "@/lib/erp/types";
import { cn } from "@/lib/erp/cn";
import { Field, inputClass, inputErrorClass } from "../ui/FormInput";

export interface PresetOrCustomValue {
  mode: "preset" | "custom";
  preset: string;
  custom: string;
  /** The unit the custom value is in, when `units` offers a choice. */
  unit?: string;
}

const CUSTOM = "__custom";

interface Props {
  label: string;
  options: Option[];
  value: PresetOrCustomValue;
  onChange: (value: PresetOrCustomValue) => void;
  customLabel: string;
  placeholder: string;
  suffix?: string;
  /** Units the custom value can be entered in; replaces `suffix` with a small dropdown. */
  units?: Option[];
  step?: string;
  min?: string;
  error?: string;
  required?: boolean;
}

/**
 * A dropdown of predefined values plus a "custom" option that reveals a free-entry
 * number field — used for duration and quantity so users aren't limited to presets.
 */
export function PresetOrCustomInput({ label, options, value, onChange, customLabel, placeholder, suffix, units, step, min, error, required }: Props) {
  const id = useId();
  const custom = value.mode === "custom";

  return (
    <Field label={label} htmlFor={id} error={error} required={required}>
      {/*
        `inputClass` makes every control `w-full`, so in custom mode each one needs its own flex basis or
        they fight over the row and the number field is squeezed down to its spinners. These fields sit in
        a half-width grid cell, which leaves too little room for three controls side by side, so the row
        wraps: the number and its unit share a box that stays together on whichever line it lands.
      */}
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          value={custom ? CUSTOM : value.preset}
          onChange={(e) =>
            onChange(e.target.value === CUSTOM ? { ...value, mode: "custom" } : { ...value, mode: "preset", preset: e.target.value })
          }
          className={cn(inputClass, "pr-8", custom && "min-w-0 grow basis-[42%]", error && inputErrorClass, !custom && !value.preset && "text-neutral-400")}
        >
          <option value="">{placeholder}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value} className="text-neutral-900">
              {option.label}
            </option>
          ))}
          <option value={CUSTOM} className="text-neutral-900">
            {customLabel}
          </option>
        </select>

        {custom && (
          <div className={cn("flex min-w-[11rem] grow gap-2", units ? "basis-56" : "basis-32")}>
            <div className="relative min-w-0 grow">
              <input
                type="number"
                inputMode="decimal"
                step={step}
                min={min}
                autoFocus
                value={value.custom}
                onChange={(e) => onChange({ ...value, custom: e.target.value })}
                placeholder="Enter value"
                aria-label={`${label} (custom)`}
                className={cn(inputClass, suffix && !units && "pr-14", error && inputErrorClass)}
              />
              {suffix && !units && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-neutral-500">{suffix}</span>}
            </div>

            {units && (
              <select
                value={value.unit ?? units[0]?.value}
                onChange={(e) => onChange({ ...value, unit: e.target.value })}
                aria-label={`${label} unit`}
                className={cn(inputClass, "shrink-0 basis-28 pr-8", error && inputErrorClass)}
              >
                {units.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}
