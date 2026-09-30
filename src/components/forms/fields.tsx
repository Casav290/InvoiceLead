import type * as React from "react";
import { cn } from "@/lib/utils";

/** Champs Trait net partagés par les formulaires de l'application. */
export const fieldClass =
  "h-10 w-full border border-line-strong bg-panel px-3 text-[14px] text-ink disabled:bg-muted disabled:text-ink-muted aria-[invalid=true]:border-hot-fg";

type Common = {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  disabled?: boolean;
};

function Messages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {hint ? (
        <span id={`${id}-hint`} className="mt-1 block text-[12px] text-ink-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={`${id}-error`} className="mt-1 block text-[12px] font-semibold text-hot-fg">
          {error}
        </span>
      ) : null}
    </>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return (
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") ||
    undefined
  );
}

export function TextField({
  id,
  name,
  label,
  hint,
  error,
  wide,
  disabled,
  defaultValue,
  type = "text",
  autoComplete,
  multiline,
}: Common & { defaultValue?: string; type?: string; autoComplete?: string; multiline?: boolean }) {
  const shared = {
    id,
    name,
    defaultValue,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy(id, hint, error),
  } as const;
  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold">
        {label}
      </label>
      {multiline ? (
        <textarea {...shared} rows={3} className={cn(fieldClass, "h-auto py-2")} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} className={fieldClass} />
      )}
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  id,
  name,
  label,
  hint,
  error,
  wide,
  disabled,
  defaultValue,
  options,
  placeholder,
}: Common & {
  defaultValue?: string;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <label htmlFor={id} className="mb-1 block text-[13px] font-semibold">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={fieldClass}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Messages id={id} hint={hint} error={error} />
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-line-strong bg-panel">
      <h2 className="border-b border-line bg-head px-5 py-3 text-[10.5px] font-extrabold tracking-[0.09em] text-ink-muted uppercase">
        {title}
      </h2>
      <div className="grid gap-4 p-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}
