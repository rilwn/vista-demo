# Test the remaining ERP reports

Restart with `npm run dev` to apply the migration. Open ERP/CRM at
[localhost:5173](http://localhost:5173/) and sign in as **manager@vista.local**
with your existing `DEV_FIXTURES_PASSWORD`. No new transactions are required.

## 1. Save a report in each module

For each row below, choose **ERP → [Module]** in the sidebar, then **Reports**
under **Choose an area**. Choose the named report from **Report**.

| Module      | Report                    | Keep these fields                                  | Report name        |
| ----------- | ------------------------- | -------------------------------------------------- | ------------------ |
| Procurement | Purchase order comparison | Supplier, Product                                  | Procurement review |
| Warehouse   | Stock and valuation       | Warehouse, Product, On hand                        | Stock review       |
| Sales       | Quotations and orders     | Quotation, Customer, Total including VAT, Currency | Sales review       |
| Logistics   | Deliveries                | Delivery, Customer, Status                         | Delivery review    |

1. For Procurement, Sales and Logistics, set **From: 2026-01-01** and
   **To: 2026-12-31**. Stock and valuation has no date fields because it shows
   current stock.
2. Leave **Search report values** empty and select **Apply**.
3. Open **Saved views & export fields**. Uncheck the fields not listed above.
4. Enter the sample **Report name**, choose **File type: Excel**, then select
   **Save as new report**. Expect **Your report view is saved.**

Rows reflect your existing records. If a report has no records, the empty
message is valid and its exported table will contain headers only.

## 2. Reopen and export each saved view

1. Select **Overview** in the sidebar, then return through the same module's
   **Reports** area.
2. Open **Saved views & export fields** and choose your report under
   **My saved reports**. Confirm the report, dates, fields and Excel return.
3. Select **Prepare export**. Under **Recent exports**, wait for **Ready**,
   then select **Download**. Use **Refresh** if needed.
4. Open the file. The table should contain only your selected fields, for all
   matching records, not just the visible page.
5. Choose **CSV**, prepare and download it. Repeat with **PDF**.
   The values should match if the underlying records did not change.

## 3. Check the other report choices

Use **Report** to open the remaining choices in each module:

- Procurement: **Supplier claims**.
- Warehouse: **Stock movements**, **Replenishment**.
- Sales: **Shipments**.
- Logistics: **Returns and repairs**, **Route plans**.

For reports with dates, use the same 2026 range and select **Apply**.
Replenishment uses current settings and has no date fields. Read the short
description below the filters for what each report includes.

Enter **NO-MATCH-TEST-2026** in Search report values and select **Apply**.
Expect **No records match these filters.** Clear it and apply again.
Uncheck every field: **Save as new report** and **Prepare export** must be
disabled. Recheck a field before continuing.
