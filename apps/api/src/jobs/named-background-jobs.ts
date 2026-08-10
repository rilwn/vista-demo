export const namedBackgroundJobs = [
  'finance.payment-status.detect',
  'finance.payment-notification.prepare',
  'sales.subscription-invoice.generate',
  'service.inspection-reminder.prepare',
  'service.plan-visit.generate',
  'crm.warranty-expiration.prepare',
  'crm.sla.evaluate',
  'report.generate',
  'backup.execute',
  'backup.verify',
  'backup.missed-detect',
  'backup.plan-review.remind',
  'backup.dr-test.remind',
] as const;

export type NamedBackgroundJob = (typeof namedBackgroundJobs)[number];
