// src/client/components/ui/Switch.tsx

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label — rendered visually next to the toggle. */
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Switch({ checked, onChange, label, disabled = false, id }: SwitchProps) {
  const switchId = id ?? (label ? `switch-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);
  return (
    <label htmlFor={switchId} className="inline-flex cursor-pointer items-center gap-3 select-none">
      <button
        id={switchId}
        role="switch"
        type="button"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-5 w-10 shrink-0 items-center rounded-full',
          'border-2 border-transparent',
          'transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--n-0)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          checked ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow',
            'transition-transform duration-[var(--dur-fast)] ease-[var(--ease)]',
            checked ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
      {label ? (
        <span className="text-[length:var(--t-base)] text-[var(--n-11)]">{label}</span>
      ) : null}
    </label>
  );
}
