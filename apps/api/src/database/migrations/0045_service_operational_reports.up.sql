INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key, available_formats, filter_schema
) VALUES
  (
    '41f22b96-cf90-4b07-a5aa-acde19b64d13',
    'service.request-register',
    'Service request register',
    'Customer requests, devices, assignments, status, and recorded costs for a selected period.',
    'service.request-register.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '2b7cfd3a-ce94-4710-8a71-2d23ca848b14',
    'service.technician-performance',
    'Technician performance',
    'Assigned and completed visits, recorded time, and service value by technician.',
    'service.technician-performance.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '8dcb62c5-0660-49df-9b2f-bb936bb87083',
    'service.cost-summary',
    'Service cost summary',
    'Labour, parts, transport, and total recorded service value grouped by service type.',
    'service.cost-summary.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );
