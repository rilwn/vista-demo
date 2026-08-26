DELETE FROM reporting.report_definitions
WHERE definition_key IN (
  'service.request-register',
  'service.technician-performance',
  'service.cost-summary'
);
