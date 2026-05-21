/**
 * Pipeline themes — per-templateId color hue + emoji icon used by the
 * Posts-tab summary cards (and reusable elsewhere) so each pipeline has
 * a glanceable visual identity.
 *
 * Why HSL hues instead of hex swatches:
 *   - the rest of RedLattice supports a per-installation accent override
 *     (Settings → Brand). Pure hex would clash. HSL lets us derive light
 *     + dark stops at runtime that read well next to any accent.
 *   - keeps the design-token spirit: one number per pipeline, all
 *     surface stops derived from it.
 *
 * To add a new template's theme: pick a hue that doesn't collide with
 * the closest sibling (~30° apart) and add a fitting emoji.
 */

export interface PipelineTheme {
  /** Base hue 0–360. */
  hue: number;
  /** Saturation %. 70 is a good default for filled accents. */
  sat: number;
  /** Emoji shown in the card's icon block. */
  icon: string;
  /** Short label for screen-reader announcement of the icon. */
  iconLabel: string;
}

// Keyed by templateId. Custom (scratch) pipelines fall through to
// DEFAULT_THEME which uses neutral grays.
const THEMES: Record<string, PipelineTheme> = {
  // Categorization / sentiment
  'intent-classifier': { hue: 244, sat: 75, icon: '🎯', iconLabel: 'target' },
  'sentiment-scorer': { hue: 340, sat: 75, icon: '❤️', iconLabel: 'heart' },
  'topic-clusterer': { hue: 188, sat: 75, icon: '🧩', iconLabel: 'puzzle piece' },
  'root-cause-summariser': { hue: 280, sat: 70, icon: '🔍', iconLabel: 'magnifying glass' },

  // Flagging / safety
  'impostor-flagger': { hue: 38, sat: 90, icon: '🎭', iconLabel: 'mask' },
  'spam-detector': { hue: 210, sat: 25, icon: '🛡️', iconLabel: 'shield' },
  'fraud-detector': { hue: 0, sat: 80, icon: '🚨', iconLabel: 'siren' },
  'pii-detector': { hue: 152, sat: 65, icon: '🔒', iconLabel: 'lock' },

  // Operational
  'volume-spike-detector': { hue: 20, sat: 85, icon: '⚡', iconLabel: 'lightning' },
  'team-response-tracker': { hue: 215, sat: 75, icon: '🤝', iconLabel: 'handshake' },

  // Extraction / counting
  'brand-mention-counter': { hue: 320, sat: 70, icon: '📊', iconLabel: 'chart' },
};

/** Fallback used for scratch / unknown templates. Stays neutral. */
const DEFAULT_THEME: PipelineTheme = { hue: 220, sat: 12, icon: '✨', iconLabel: 'sparkle' };

export function getPipelineTheme(templateId: string | undefined): PipelineTheme {
  if (!templateId) return DEFAULT_THEME;
  return THEMES[templateId] ?? DEFAULT_THEME;
}

/**
 * Build the inline-style CSS variables a card needs. We expose them as
 * vars so children (icon block, kind chip, hover ring) can reuse without
 * threading props.
 *
 * - `--pt-tint`   very faint background wash (~6% L 14% S in dark, swapped in light)
 * - `--pt-glow`   stronger radial glow used in the top-right corner
 * - `--pt-edge`   the 1.5px left accent stripe
 * - `--pt-chip`   kind-chip background
 * - `--pt-text`   readable text on the chip
 */
export function pipelineThemeVars(t: PipelineTheme): React.CSSProperties {
  // We deliberately use HSL with alpha so cards look correct on both
  // light and dark surfaces without needing a media query.
  const { hue, sat } = t;
  return {
    // top-right radial glow (low alpha, large radius)
    ['--pt-glow' as string]: `hsla(${hue}, ${sat}%, 60%, 0.18)`,
    // 1.5px left accent edge
    ['--pt-edge' as string]: `hsla(${hue}, ${sat}%, 60%, 0.9)`,
    // kind-chip background
    ['--pt-chip' as string]: `hsla(${hue}, ${sat}%, 60%, 0.18)`,
    // chip text — desaturate slightly for readability
    ['--pt-text' as string]: `hsla(${hue}, ${Math.max(sat - 10, 0)}%, 75%, 1)`,
    // icon block background
    ['--pt-icon-bg' as string]: `hsla(${hue}, ${sat}%, 55%, 0.15)`,
    // hover border
    ['--pt-border-hover' as string]: `hsla(${hue}, ${sat}%, 55%, 0.6)`,
  };
}
