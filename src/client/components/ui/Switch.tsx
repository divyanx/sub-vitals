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
          'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full',
          // No border-2 — it was subtracting from the inner content area
          // and pushing the knob flush against / past the right edge.
          'transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--n-0)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          checked ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            // h-5 w-5 knob inside h-6 w-11 pill = 2px symmetric padding
            // on every side when checked / unchecked. Geometry exact.
            'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow',
            'transition-transform duration-[var(--dur-fast)] ease-[var(--ease)]',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          ].join(' ')}
        />
      </button>
      {label ? (
        <span className="text-[length:var(--t-base)] text-[var(--n-11)]">{label}</span>
      ) : null}
    </label>
  );
}
