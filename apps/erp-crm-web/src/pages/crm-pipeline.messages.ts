import type { CrmLead, CrmLeadStatus, CrmOpportunity, CrmOpportunityStage } from '@vista/contracts';

import type { OperationsLocale } from '../i18n/LocalizationProvider';

const leadStatuses: Record<OperationsLocale, Record<CrmLeadStatus, string>> = {
  en: { converted: 'Converted', new: 'New', qualified: 'Qualified' },
  bg: { converted: 'Преобразуван', new: 'Нов', qualified: 'Квалифициран' },
};

const opportunityStages: Record<OperationsLocale, Record<CrmOpportunityStage, string>> = {
  en: {
    lost: 'Lost',
    negotiation: 'Negotiation',
    new: 'New',
    qualified: 'Qualified',
    quotation_sent: 'Quotation sent',
    won: 'Won',
  },
  bg: {
    lost: 'Загубена',
    negotiation: 'Договаряне',
    new: 'Нова',
    qualified: 'Квалифицирана',
    quotation_sent: 'Изпратена оферта',
    won: 'Спечелена',
  },
};

export function crmLeadStatusLabel(status: CrmLeadStatus, locale: OperationsLocale): string {
  return leadStatuses[locale][status];
}

export function crmOpportunityStageLabel(
  stage: CrmOpportunityStage,
  locale: OperationsLocale,
): string {
  return opportunityStages[locale][stage];
}

export function crmLeadHistoryLabel(
  type: CrmLead['history'][number]['type'],
  locale: OperationsLocale,
): string {
  if (locale === 'en') {
    return type === 'created'
      ? 'Lead registered'
      : type === 'qualified'
        ? 'Lead qualified'
        : 'Lead converted';
  }
  return type === 'created'
    ? 'Потенциалният клиент е регистриран'
    : type === 'qualified'
      ? 'Потенциалният клиент е квалифициран'
      : 'Потенциалният клиент е преобразуван';
}

export function crmOpportunityHistoryLabel(
  item: CrmOpportunity['history'][number],
  locale: OperationsLocale,
): string {
  if (locale === 'en') {
    if (item.type === 'created')
      return `Added to ${crmOpportunityStageLabel(item.nextStage, locale)}`;
    if (item.type === 'quotation_linked') return 'Sales quotation linked';
    return `Moved from ${crmOpportunityStageLabel(item.previousStage!, locale)} to ${crmOpportunityStageLabel(item.nextStage, locale)}`;
  }
  if (item.type === 'created')
    return `Възможността е добавена в етап „${crmOpportunityStageLabel(item.nextStage, locale)}“`;
  if (item.type === 'quotation_linked') return 'Офертата за продажба е свързана';
  return `Възможността е преместена от „${crmOpportunityStageLabel(item.previousStage!, locale)}“ в „${crmOpportunityStageLabel(item.nextStage, locale)}“`;
}

export function crmOpportunityMovedNotice(
  number: string,
  stage: CrmOpportunityStage,
  locale: OperationsLocale,
): string {
  const label = crmOpportunityStageLabel(stage, locale);
  return locale === 'bg' ? `${number} премина в етап „${label}“.` : `${number} moved to ${label}.`;
}

export function formatCrmPipelineDate(value: string, locale: OperationsLocale): string {
  const date = /^\d{4}-\d{2}-\d{2}$/u.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    dateStyle: 'medium',
  }).format(date);
}

export function formatCrmPipelineDateTime(value: string, locale: OperationsLocale): string {
  return new Intl.DateTimeFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function crmLeadCountSummary(count: number, locale: OperationsLocale): string {
  const formatted = new Intl.NumberFormat(locale === 'bg' ? 'bg-BG' : 'en-GB').format(count);
  if (locale === 'bg') return `Потенциални клиенти в този изглед: ${formatted}`;
  return `${formatted} ${count === 1 ? 'lead' : 'leads'} in this view`;
}

export function crmOpportunityCountSummary(count: number, locale: OperationsLocale): string {
  const formatted = new Intl.NumberFormat(locale === 'bg' ? 'bg-BG' : 'en-GB').format(count);
  if (locale === 'bg') return `Възможности в изгледа: ${formatted}`;
  return `${formatted} ${count === 1 ? 'opportunity' : 'opportunities'} shown`;
}
