import { describe, expect, it } from 'vitest';
import { helpTopics } from './help-content';

describe('workspace help', () => {
  it('only includes Operations modules granted to the employee', () => {
    const topics = helpTopics('operations', ['erp.service']);
    expect(topics.some((topic) => topic.id === 'service')).toBe(true);
    expect(topics.some((topic) => topic.id === 'finance')).toBe(false);
    expect(topics.some((topic) => topic.id === 'access')).toBe(true);
  });
  it('does not present checkout recovery as offline selling', () => {
    expect(helpTopics('pos').find((topic) => topic.id === 'checkout')?.note).toContain(
      'not full offline selling',
    );
  });
  it('states the Recovery console cannot protect live data yet', () => {
    expect(helpTopics('recovery')[0]?.note).toContain('does not create restore points');
  });
  it('has unique topics and complete steps in each app', () => {
    for (const app of ['operations', 'pos', 'recovery'] as const) {
      const topics = helpTopics(app, [
        'erp.finance',
        'erp.sales',
        'erp.service',
        'erp.warehouse',
        'erp.procurement',
        'erp.logistics',
        'crm',
      ]);
      expect(new Set(topics.map((topic) => topic.id)).size).toBe(topics.length);
      expect(topics.every((topic) => topic.steps.length === 3)).toBe(true);
    }
  });
});
