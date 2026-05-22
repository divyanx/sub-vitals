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
          'relative inline-block h-6 w-11 shrink-0 cursor-pointer rounded-full',
          'transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-9)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--n-0)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          checked ? 'bg-[var(--accent-9)]' : 'bg-[var(--n-5)]',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            // Absolute-positioned knob anchored to the pill edges via
            // `left` / `right`. Avoids the translate-x arbitrary-value
            // path that was reportedly bleeding past the right edge.
            //   pill 44, knob 20, 2px padding → left:2 OFF, right:2 ON
            'pointer-events-none absolute top-0.5 h-5 w-5 rounded-full bg-white shadow',
            'transition-[left,right] duration-[var(--dur-fast)] ease-[var(--ease)]',
            checked ? 'right-0.5 left-auto' : 'left-0.5 right-auto',
          ].join(' ')}
        />
      </button>
      {label ? (
        <span className="text-[length:var(--t-base)] text-[var(--n-11)]">{label}</span>
      ) : null}
    </label>
  );
}
