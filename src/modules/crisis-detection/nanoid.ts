/**
 * Tiny collision-resistant ID generator for incident IDs.
 * Uses `crypto.randomUUID()` (Node 14.17+ built-in, no npm dep).
 */
export function nanoid(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}
