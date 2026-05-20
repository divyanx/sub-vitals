// src/client/components/ui/Select.tsx
import type React from 'react';

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  helper?: string;
  error?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
}

export function Select({
  label,
  helper,
  error,
  onChange,
  id,
  className = '',
  children,
  ...rest
}: SelectProps) {
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
      <select
        id={inputId}
        onChange={(e) => onChange?.(e.target.value)}
        className={[
          'w-full rounded-[var(--r-2)] border bg-[var(--input-bg)] px-3 py-2',
          'text-[length:var(--t-base)] text-[var(--n-11)]',
          'min-h-[44px] cursor-pointer',
          'outline-none transition-colors duration-[var(--dur-fast)]',
          error
            ? 'border-[var(--error-9)]'
            : 'border-[var(--n-4)] focus:border-[var(--accent-9)] focus-visible:ring-2 focus-visible:ring-[var(--accent-9)]',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p className="text-[length:var(--t-xs)] text-[var(--error-11)]">{error}</p>
      ) : helper ? (
        <p className="text-[length:var(--t-xs)] text-[var(--n-8)]">{helper}</p>
      ) : null}
    </div>
  );
}
