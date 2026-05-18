/**
 * Shared encoder/decoder for `pipelineTags` URL state.
 *
 * Format:  tag_{pipelineId}=val1,val2
 * Example: tag_intent=bug,billing&tag_sentiment=negative
 *
 * This module is the single source of truth used by both:
 *   - ContentBrowser (URL ↔ filter state)
 *   - api.contentSearch (ContentSearchParams → URLSearchParams)
 */

/**
 * Write all active pipeline tag filters into an existing URLSearchParams.
 * Skips pipelines with an empty value array.
 */
export function encodePipelineTags(
  pipelineTags: Record<string, string[]> | null | undefined,
  p: URLSearchParams,
): void {
  if (!pipelineTags) return;
  for (const [pipelineId, values] of Object.entries(pipelineTags)) {
    if (values.length > 0) {
      p.set(`tag_${pipelineId}`, values.join(','));
    }
  }
}

/**
 * Read all `tag_*` keys from URLSearchParams and return a
 * `Record<pipelineId, string[]>` (empty object when none present).
 */
export function decodePipelineTags(p: URLSearchParams): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, value] of p.entries()) {
    if (key.startsWith('tag_')) {
      const pipelineId = key.slice(4);
      result[pipelineId] = value.split(',').filter(Boolean);
    }
  }
  return result;
}
