"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import type { Option } from "@/lib/erp/types";
import { cn } from "@/lib/erp/cn";
import { Icon } from "./Icon";

export const inputClass =
  "block w-full rounded-md border-0 bg-paper px-3 py-2 text-sm text-neutral-900 shadow-sm ring-1 ring-inset ring-neutral-300 " +
  "placeholder:text-neutral-400 focus:ring-2 focus:ring-inset focus:ring-ink disabled:bg-neutral-50 disabled:text-neutral-500";

export const inputErrorClass = "ring-2 ring-ink focus:ring-ink";

interface FieldProps {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error wrapper used by all form controls. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-neutral-700">
          {label}
          {required && <span className="ml-0.5 text-brand-dark">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-ink">
          <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-paper">!</span>
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>
      )}
    </div>
  );
}

interface FormInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
}

export function FormInput({ label, error, hint, className, id, required, type, disabled, ...props }: FormInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  // Password fields get a show/hide toggle; it resets to hidden on remount.
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";

  const input = (
    <input
      id={inputId}
      type={isPassword && revealed ? "text" : type}
      required={required}
      disabled={disabled}
      aria-invalid={Boolean(error)}
      className={cn(inputClass, error && inputErrorClass, isPassword && "pr-10")}
      {...props}
    />
  );

  return (
    <Field label={label} htmlFor={inputId} error={error} hint={hint} required={required} className={className}>
      {isPassword ? (
        <div className="relative">
          {input}
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            disabled={disabled}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            aria-controls={inputId}
            title={revealed ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-3 text-neutral-500 hover:text-ink focus:outline-none focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink disabled:pointer-events-none"
          >
            <Icon name={revealed ? "eyeOff" : "eye"} className="h-4 w-4" />
          </button>
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  label?: string;
  error?: string;
  hint?: ReactNode;
  className?: string;
}

export function TextArea({ label, error, hint, className, id, required, rows = 3, ...props }: TextAreaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} error={error} hint={hint} required={required} className={className}>
      <textarea
        id={inputId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error)}
        className={cn(inputClass, error && inputErrorClass)}
        {...props}
      />
    </Field>
  );
}

/** A row of radio buttons styled as selectable chips. */
export function RadioGroup({ label, name, options, value, onChange, hint, error }: {
  label: string;
  name: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-neutral-700">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
              value === option.value ? "border-ink bg-brand/25 font-medium text-ink" : "border-neutral-300 bg-paper text-neutral-700 hover:border-ink",
            )}
          >
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="accent-ink" />
            {option.label}
          </label>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-xs font-medium text-ink">{error}</p> : hint && <p className="mt-1.5 text-xs text-neutral-500">{hint}</p>}
    </fieldset>
  );
}

export function Checkbox({ label, checked, onChange, hint, disabled }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-neutral-300 accent-ink"
      />
      <label htmlFor={id} className="text-sm text-neutral-700">
        {label}
        {hint && <span className="block text-xs text-neutral-500">{hint}</span>}
      </label>
    </div>
  );
}
