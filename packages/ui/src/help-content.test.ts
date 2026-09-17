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
  it('provides complete Bulgarian topics for every application', () => {
    const modules = [
      'erp.finance',
      'erp.sales',
      'erp.service',
      'erp.warehouse',
      'erp.procurement',
      'erp.logistics',
      'crm',
    ];
    for (const app of ['operations', 'pos', 'recovery'] as const) {
      const english = helpTopics(app, modules);
      const bulgarian = helpTopics(app, modules, 'bg');
      expect(bulgarian).toHaveLength(english.length);
      expect(bulgarian.every((topic, index) => topic.title !== english[index]?.title)).toBe(true);
      expect(bulgarian.every((topic) => topic.steps.length === 3)).toBe(true);
    }
  });
  it('shows the relevant page guide without adding unrelated page guides', () => {
    const finance = helpTopics('operations', ['erp.finance'], 'en', '/modules/erp.finance/cash');
    expect(finance[0]?.id).toBe('cash-bank');
    expect(finance.some((topic) => topic.id === 'subscriptions')).toBe(false);

    const pos = helpTopics('pos', [], 'bg', 'reports');
    expect(pos[0]?.id).toBe('pos-reports');
    expect(pos[0]?.title).toBe('Преглед и експорт на POS отчети');

    const recovery = helpTopics('recovery', [], 'en', 'jobs');
    expect(recovery[0]?.id).toBe('recovery-area');
  });
});
