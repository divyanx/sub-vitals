/**
 * InfoTooltip — pure CSS tooltip wrapping an info icon.
 * No library dependency; uses .tooltip-wrapper / .tooltip-content classes
 * defined in styles.css.
 *
 * Usage:
 *   <InfoTooltip tip="Explains the metric" />
 */

interface InfoTooltipProps {
  tip: string;
  className?: string;
}

export function InfoTooltip({ tip, className = '' }: InfoTooltipProps) {
  return (
    <span className={`tooltip-wrapper ml-1 ${className}`}>
      <button
        type="button"
        aria-label={`Info: ${tip}`}
        className="inline-flex h-3.5 w-3.5 flex-shrink-0 cursor-help items-center justify-center rounded-full border border-current text-[9px] leading-none text-[var(--text-muted)] opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        tabIndex={0}
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
      <span className="tooltip-content" role="tooltip">
        {tip}
      </span>
    </span>
  );
}
