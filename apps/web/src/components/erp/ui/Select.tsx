import { useId, type ReactNode, type SelectHTMLAttributes } from "react";
import type { Option } from "@/lib/erp/types";
import { cn } from "@/lib/erp/cn";
import { Field, inputClass, inputErrorClass } from "./FormInput";

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "onChange" | "value"> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  /** Shown as the first, empty option. */
  placeholder?: string;
}

export function Select({ label, error, hint, className, options, value, onChange, placeholder, id, required, ...props }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={selectId} error={error} hint={hint} required={required} className={className}>
      <select
        id={selectId}
        value={value}
        required={required}
        aria-invalid={Boolean(error)}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "pr-8", error && inputErrorClass, !value && "text-neutral-400")}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value} className="text-neutral-900">
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
