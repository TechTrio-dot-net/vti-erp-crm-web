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

  return (
    <Field label={label} htmlFor={id} error={error} required={required}>
      <div className="flex gap-2">
        <select
          id={id}
          value={value.mode === "custom" ? CUSTOM : value.preset}
          onChange={(e) =>
            onChange(e.target.value === CUSTOM ? { ...value, mode: "custom" } : { ...value, mode: "preset", preset: e.target.value })
          }
          className={cn(inputClass, "pr-8", value.mode === "custom" && "max-w-[45%]", error && inputErrorClass, value.mode === "preset" && !value.preset && "text-neutral-400")}
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

        {value.mode === "custom" && (
          <div className="relative flex-1">
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
              className={cn(inputClass, suffix && "pr-14", error && inputErrorClass)}
            />
            {suffix && !units && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-neutral-500">{suffix}</span>}
          </div>
        )}

        {value.mode === "custom" && units && (
          <select
            value={value.unit ?? units[0]?.value}
            onChange={(e) => onChange({ ...value, unit: e.target.value })}
            aria-label={`${label} unit`}
            className={cn(inputClass, "w-auto pr-8", error && inputErrorClass)}
          >
            {units.map((unit) => (
              <option key={unit.value} value={unit.value}>
                {unit.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </Field>
  );
}
