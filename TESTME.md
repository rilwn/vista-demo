# Test Finance balances and reminders

This is the complete browser test for the Finance aging, partner-turnover, and
in-system payment-reminder milestone.

## Start

1. Run `npm run dev`.
2. Open `http://localhost:5173` and sign in as `finance@vista.local` with your
   configured `DEV_FIXTURES_PASSWORD`.

## 1. Review receivable and payable aging

1. From the sidebar choose **ERP → Finance → Balances & turnover**.
2. Keep **Aging & balances** and **Receivables** selected.
3. Review the document number, source, customer, due date, aging bucket, and BGN
   balance for each row.
4. Select **Payables** and review the same fields for suppliers.

Expected:

- **Total open** equals **Not due** plus the four overdue buckets.
- A future or current due date is **Not due**.
- A past due date appears in **0–30**, **31–60**, **61–90**, or **Over 90**
  according to its age.
- The report body is solid, aligned, readable, and responsive.

## 2. Review turnover by partner

1. Select **Turnover by partner**.
2. Keep **Customers** selected.
3. Enter:
   - From: `2026-08-01`
   - To: `2026-08-21`
4. Select **Apply**.
5. Select **Suppliers**, keep the same dates, and select **Apply** again.

Expected:

- Documents are grouped by customer or supplier.
- **Gross turnover** is the value of documents dated inside the selected period.
- **Allocated** and **Outstanding** show the current state of those documents.
- Entering a From date after the To date disables **Apply**.

## 3. Create and read a due-soon reminder

1. From the Finance tabs choose **Collections & payments**.
2. Select **Add to collections**.
3. Choose a prepared Sales invoice draft whose displayed amount is greater than
   **BGN 0.00**.
4. Set the due date between one and seven days from today. For example, use
   `2026-08-27` when testing on `2026-08-21`.
5. Select **Add record**.
6. The collection preview opens. Select **Back** and confirm that the new record
   remains visible in the collection register with `0 payments` and its full
   outstanding balance.
7. Wait up to ten seconds, then open the notification bell in the top bar.

Expected: one unread **Payment is due soon** notification shows the Finance
number, customer, BGN balance, and due date. Opening it marks it read. Closing
and reopening the notification centre does not create a duplicate.

A zero-value Sales draft is not offered because it has no balance to collect and
cannot produce a payment reminder.

### If no prepared Sales draft is available

1. From the sidebar choose **ERP → Sales → Quotations → New quotation**.
2. Enter:
   - Customer: **Alfa Market Demo Ltd.**
   - Warehouse: **Demo Central Warehouse**
   - Valid until: any future date
   - Currency: `BGN`
   - Product: **Demo 12 V Power Adapter**
   - Quantity: `1`
   - Unit price: `50`
   - Line discount: `0`
   - VAT: **20% VAT**
   - Overall discount: `0`
3. Select **Create quotation**, then **Preview**.
4. Select **Confirm order and reserve stock**, then **Complete shipment**.
5. Enter customer representative `Finance reminder test`, select
   **Record customer acceptance**, then **Prepare invoice draft**.
6. Return to **ERP → Finance → Collections & payments** and repeat step 3.

If confirmation reports insufficient stock, use **ERP → Warehouse → Stock
movements → Receive** to receive **Demo 12 V Power Adapter** into **Demo Central
Warehouse**, then return to the quotation and confirm it. Do not rerun the
fixture seed to replenish stock.

## Current boundary

This milestone does not claim provider-delivered email reminders, legal invoice
issuance, official sales or purchase journals, VAT reporting, accounting export,
saved report definitions, or Excel/CSV/PDF report downloads. Those remain
pending.
