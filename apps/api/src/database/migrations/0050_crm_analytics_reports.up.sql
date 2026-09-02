INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key, available_formats, filter_schema
) VALUES
  (
    '4d0082c4-64c0-46a3-b51b-009a7c5fdd33',
    'crm.customer-value',
    'Customer value and retention',
    'Purchase frequency, transaction value, retention, churn, and observed customer value for a selected period.',
    'crm.customer-value.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '7882ae0d-faaa-4956-b257-be9a05016e3e',
    'crm.pipeline-performance',
    'Pipeline conversion',
    'Opportunity entry and conversion by stage for the selected creation cohort.',
    'crm.pipeline-performance.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    'b3112af8-7d47-4ff4-b8cc-258e49787625',
    'crm.employee-performance',
    'Employee performance',
    'Completed Service requests, resolved CRM tickets, and completed Sales shipments by responsible employee.',
    'crm.employee-performance.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '4ff2ab7e-7a33-4f73-a7aa-99f142f8a94e',
    'crm.revenue-breakdown',
    'CRM revenue breakdown',
    'Recorded non-cancelled financial-document value by product, service, customer, region, and responsible employee.',
    'crm.revenue-breakdown.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );
