-- Restore the prior demo labels when explicitly rolling back this migration.
UPDATE sales.price_lists
SET code = 'DEMO-RETAIL-BGN',
    name = 'Demo retail BGN prices'
WHERE code = 'DEMO-RETAIL-EUR';

UPDATE sales.price_lists
SET code = 'DEMO-POS-BGN'
WHERE code = 'DEMO-POS-EUR';
