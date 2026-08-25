# Test the supplier-invoice UI fixes

## Start

1. If development is already running, stop it once with `Ctrl+C` so the shared
   choice-field update is reloaded.
2. Run `npm run dev`.
3. Open the ERP/CRM app and sign in as `manager@vista.local`.

## 1. Check the invoice panels

1. From the sidebar choose **ERP → Procurement → Supplier invoices**.
2. Select **Record supplier invoice**.
3. Select **Purchase order**. Type `TechSupply`, then choose the adapter order
   from the list beneath the field.

Expected: the choices appear in a clean light panel that matches the app, not a
black browser menu. The form has three clear sections, readable quantity
comparisons, aligned fields, square product checkboxes, a scrolling body, and a
fitted action bar. Select **Back**; no invoice needs to be saved.

4. Find `TEST-VAT-2026-0825-01` and select **Preview**.

Expected: the invoice total, supplier details, VAT status, order quantities,
and line values are separated clearly. **Back** returns to the invoice list.

## 2. Check the Finance warning

1. From the sidebar choose **ERP → Finance → Finance reports**.
2. Select **Document journals → Purchases → Apply**.

Expected: the warning names the earlier invoice without VAT details and
explains that it remains in the journal but is excluded from VAT totals. This
is expected historical data, not a failed test.

## 3. Check searchable choices

Open any create panel with a choice field, such as **ERP → Sales → Quotations →
New quotation**. Type part of a customer, warehouse, or product name and choose
the matching suggestion.

Expected: single-choice fields filter suggestions while typing. Multiple serial
number lists have their own search field and preserve multiple selection. Press
the arrow keys and **Enter** once to confirm keyboard selection also works.
