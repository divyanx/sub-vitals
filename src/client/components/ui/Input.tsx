// src/client/components/ui/Input.tsx
import type React from 'react';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  /** Visible label rendered above the input. */
  label?: string;
  /** Helper text rendered below the input. */
  helper?: string;
  /** Error text — replaces helper, applies error styling. */
  error?: string;
  onChange?: (value: string) => void;
}

export function Input({ label, helper, error, onChange, id, className = '', ...rest }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <label
          htmlFor={inputId}
          className="text-[length:var(--t-xs)] font-medium text-[var(--n-11)]"
        >
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        onChange={(e) => onChange?.(e.target.value)}
        className={[
          'w-full rounded-[var(--r-2)] border bg-[var(--input-bg)] px-3 py-2',
          'text-[length:var(--t-base)] text-[var(--n-11)]',
          'outline-none transition-colors duration-[var(--dur-fast)]',
          'min-h-[44px]',
          error
            ? 'border-[var(--error-9)] focus:border-[var(--error-9)] focus-visible:ring-2 focus-visible:ring-[var(--error-9)]'
            : 'border-[var(--n-4)] focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]',
          'focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--n-0)]',
          className,
        ].join(' ')}
        {...rest}
      />
      {error ? (
        <p className="text-[length:var(--t-xs)] text-[var(--error-11)]">{error}</p>
      ) : helper ? (
        <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">{helper}</p>
      ) : null}
    </div>
  );
}
