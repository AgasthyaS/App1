import { describe, expect, it } from 'vitest';

import { runFormulaChecks } from '@/lib/formulaCheck';

/** The app's built-in reference checks, run in CI instead of only on a phone. */
describe('formulaCheck (in-app self-checks)', () => {
  const report = runFormulaChecks();
  for (const c of report.checks) {
    it(`${c.formula} [${c.id}]: ${c.statement}`, () => {
      expect(c.passed, c.got != null ? `got ${c.got}, expected ${c.expected} ± ${c.tolerance}` : undefined).toBe(true);
    });
  }
});
