// src/client/components/ui/Button.tsx
import type React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. Default: 'primary' */
  variant?: ButtonVariant;
  /** Touch-target size. Default: 'md' */
  size?: ButtonSize;
  /** Shows a spinner and disables interaction. */
  isLoading?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent-9)] text-white border-transparent hover:bg-[var(--accent-10)] focus-visible:ring-[var(--accent-9)]',
  secondary:
    'bg-[var(--n-3)] text-[var(--n-11)] border-[var(--n-5)] hover:bg-[var(--n-4)] focus-visible:ring-[var(--n-6)]',
  ghost:
    'bg-transparent text-[var(--n-11)] border-transparent hover:bg-[var(--n-3)] focus-visible:ring-[var(--n-6)]',
  destructive:
    'bg-[var(--error-3)] text-[var(--error-11)] border-[var(--error-9)] hover:bg-[var(--error-9)] hover:text-white focus-visible:ring-[var(--error-9)]',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[var(--t-sm)] rounded-[var(--r-2)]',
  md: 'h-11 px-4 text-[var(--t-base)] rounded-[var(--r-2)]',
  lg: 'h-11 px-5 text-[var(--t-md)] rounded-[var(--r-3)]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      className={[
        'inline-flex items-center justify-center gap-2 border font-medium',
        'transition-colors duration-[var(--dur-fast)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--n-0)]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variantClass[variant],
        sizeClass[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {isLoading ? (
        <svg
          aria-hidden="true"
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : null}
      {children}
    </button>
  );
}
