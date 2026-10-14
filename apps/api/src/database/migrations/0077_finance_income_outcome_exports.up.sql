INSERT INTO reporting.report_definitions (
  id, definition_key, name, description, implementation_key,
  available_formats, filter_schema
) VALUES
  (
    'd7187584-85cd-42c6-b449-4db3e384d21b',
    'finance.income',
    'Income',
    'Issued customer invoices and correction notes with recorded payments and tax rates.',
    'finance.income.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  ),
  (
    '6d5fdcce-d037-4df9-85db-29b513f6cfc8',
    'finance.outcome',
    'Outcome',
    'Supplier invoices with recorded tax details and payments.',
    'finance.outcome.v1',
    ARRAY['csv', 'xlsx', 'pdf']::varchar[],
    '{"type":"object","additionalProperties":false,"required":["dateFrom","dateTo"],"properties":{"dateFrom":{"type":"string","format":"date"},"dateTo":{"type":"string","format":"date"}}}'::jsonb
  );
