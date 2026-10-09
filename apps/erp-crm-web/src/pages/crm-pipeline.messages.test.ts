import { describe, expect, it } from 'vitest';

import {
  crmLeadHistoryLabel,
  crmLeadStatusLabel,
  crmOpportunityHistoryLabel,
  crmLeadCountSummary,
  crmOpportunityMovedNotice,
  crmOpportunityCountSummary,
  crmOpportunityStageLabel,
  formatCrmPipelineDate,
  formatCrmPipelineDateTime,
} from './crm-pipeline.messages';

describe('CRM pipeline language', () => {
  it('uses natural status forms for leads and opportunities in both languages', () => {
    expect(crmLeadStatusLabel('qualified', 'en')).toBe('Qualified');
    expect(crmLeadStatusLabel('qualified', 'bg')).toBe('Квалифициран');
    expect(crmOpportunityStageLabel('qualified', 'bg')).toBe('Квалифицирана');
    expect(crmOpportunityStageLabel('won', 'en')).toBe('Won');
    expect(crmOpportunityStageLabel('won', 'bg')).toBe('Спечелена');
    expect(crmOpportunityStageLabel('quotation_sent', 'bg')).toBe('Изпратена оферта');
  });

  it('keeps history and success messages fully in the selected language', () => {
    const leadHistoryType = 'qualified' as const;
    const opportunityHistoryEntry = {
      changedAt: '2026-10-09T10:00:00.000Z',
      changedByName: 'Vista Demo Manager',
      id: 'history-1',
      nextStage: 'quotation_sent' as const,
      previousStage: 'qualified' as const,
      probabilityPercent: 60,
      type: 'stage_changed' as const,
    };

    expect(crmLeadHistoryLabel(leadHistoryType, 'bg')).toBe('Потенциалният клиент е квалифициран');
    expect(crmOpportunityHistoryLabel(opportunityHistoryEntry, 'bg')).toBe(
      'Възможността е преместена от „Квалифицирана“ в „Изпратена оферта“',
    );
    expect(crmOpportunityMovedNotice('OPP-2026-000001', 'won', 'bg')).toBe(
      'OPP-2026-000001 премина в етап „Спечелена“.',
    );
    expect(crmOpportunityMovedNotice('OPP-2026-000001', 'won', 'en')).toBe(
      'OPP-2026-000001 moved to Won.',
    );
  });

  it('formats pipeline dates using the selected interface language', () => {
    const englishDate = formatCrmPipelineDate('2026-10-09', 'en');
    const bulgarianDate = formatCrmPipelineDate('2026-10-09', 'bg');

    expect(englishDate).toContain('Oct');
    expect(bulgarianDate).not.toContain('Oct');
    expect(formatCrmPipelineDateTime('2026-10-09T10:05:00.000Z', 'bg')).not.toContain('Oct');
  });

  it('uses complete lead and opportunity count summaries in both languages', () => {
    expect(crmLeadCountSummary(0, 'bg')).toBe('Потенциални клиенти в този изглед: 0');
    expect(crmLeadCountSummary(1, 'en')).toBe('1 lead in this view');
    expect(crmOpportunityCountSummary(12, 'bg')).toBe('Възможности в изгледа: 12');
    expect(crmOpportunityCountSummary(2, 'en')).toBe('2 opportunities shown');
  });
});
