// src/client/components/ui/Tooltip.tsx
import type React from 'react';

export interface TooltipProps {
  /** The trigger element (the thing users hover on). */
  children: React.ReactNode;
  /** The tooltip content. */
  content: React.ReactNode;
}

export function Tooltip({ children, content }: TooltipProps) {
  return (
    <span className="tooltip-wrapper">
      {children}
      <span role="tooltip" className="tooltip-content">
        {content}
      </span>
    </span>
  );
}
