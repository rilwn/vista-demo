-- Keep existing development price-list labels aligned with the EUR migration.
UPDATE sales.price_lists
SET code = 'DEMO-RETAIL-EUR',
    name = 'Demo retail EUR prices'
WHERE code = 'DEMO-RETAIL-BGN';

UPDATE sales.price_lists
SET code = 'DEMO-POS-EUR'
WHERE code = 'DEMO-POS-BGN';
