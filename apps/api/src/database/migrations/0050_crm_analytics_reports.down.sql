DELETE FROM reporting.report_definitions
WHERE definition_key IN (
  'crm.customer-value',
  'crm.pipeline-performance',
  'crm.employee-performance',
  'crm.revenue-breakdown'
);
