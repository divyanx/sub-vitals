/**
 * taxonomy-templates.test.ts
 *
 * Validates all 6 pre-built taxonomy template JSON files parse cleanly
 * through taxonomyArraySchema. Any depth violations, cycles, or dangling
 * parentIds will surface here before they reach a real install.
 */

import { describe, expect, it } from 'vitest';
import ecommerce from '../src/shared/taxonomy-templates/ecommerce.json';
import finance from '../src/shared/taxonomy-templates/finance.json';
import gaming from '../src/shared/taxonomy-templates/gaming.json';
import hardware from '../src/shared/taxonomy-templates/hardware.json';
import media from '../src/shared/taxonomy-templates/media.json';
import saas from '../src/shared/taxonomy-templates/saas.json';
import { taxonomyArraySchema } from '../src/shared/validation.ts';

const TEMPLATES = [
  { id: 'ecommerce', data: ecommerce },
  { id: 'saas', data: saas },
  { id: 'hardware', data: hardware },
  { id: 'gaming', data: gaming },
  { id: 'finance', data: finance },
  { id: 'media', data: media },
] as const;

describe('taxonomy template JSON files', () => {
  for (const { id, data } of TEMPLATES) {
    it(`${id}: parses cleanly through taxonomyArraySchema`, () => {
      const result = taxonomyArraySchema.safeParse(data);
      if (!result.success) {
        // Surface readable error messages for easier debugging
        const msgs = result.error.issues.map((i) => `  [${String(i.path)}] ${i.message}`);
        throw new Error(`${id} failed validation:\n${msgs.join('\n')}`);
      }
      expect(result.success).toBe(true);
    });

    it(`${id}: all node IDs are unique`, () => {
      const ids = (data as Array<{ id: string }>).map((n) => n.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it(`${id}: depth does not exceed 3`, () => {
      const nodes = data as Array<{ id: string; parentId?: string | null }>;
      const parentMap = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
      for (const node of nodes) {
        let depth = 1;
        let current: string | null | undefined = node.parentId ?? null;
        const visited = new Set<string>();
        while (current) {
          if (visited.has(current)) break; // cycle guard
          visited.add(current);
          depth++;
          current = parentMap.get(current) ?? null;
        }
        expect(depth, `${node.id} depth`).toBeLessThanOrEqual(3);
      }
    });

    it(`${id}: has at least 5 drivers`, () => {
      expect((data as unknown[]).length).toBeGreaterThanOrEqual(5);
    });
  }
});
