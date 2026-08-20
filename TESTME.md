# Test supplier payables

This is the complete browser test for the new supplier payable, payment,
advance, offset, and outgoing-bank matching workflow.

## Start

1. Run `npm run dev`. Startup applies migration `0037` and prepares the local
   fixtures; do not run a separate seed command.
2. Open `http://localhost:5173` and sign in as `manager@vista.local` with your
   configured `DEV_FIXTURES_PASSWORD`.

## 1. Add the supplier payable

1. From the sidebar choose **ERP → Finance → Supplier payables**.
2. Select **Add supplier invoice**.
3. Choose **DEV-SUP-INV-001 · TechSupply Demo Ltd. · BGN 33.00**.
4. Keep the suggested due date and select **Add payable**.
5. Note the new `SP-...` number.

Expected: the preview shows TechSupply, source invoice `DEV-SUP-INV-001`, total
BGN 33.00, status **Unpaid**, and BGN 33.00 remaining.

If `DEV-SUP-INV-001` is absent, it has already been used in Finance. Create a
fresh supplier invoice through **ERP → Procurement → Purchase orders**, receive
it, then record its supplier invoice from **Supplier invoices** before returning
here.

## 2. Record a partial supplier payment

1. In the payable preview select **Record payment**.
2. Enter:
   - Amount: `5`
   - Payment date: keep today
   - Payment method: **Bank transfer**
   - Reference: `SUP-PARTIAL-2026-08-20-01`
3. Select **Record payment**.

Expected: status becomes **Partially paid**, the payment trail contains an
`SPAY-...` record, and BGN 28.00 remains.

## 3. Record and allocate an advance

1. Use **Back**, then select **New advance**.
2. Enter:
   - Supplier: **TechSupply Demo Ltd.**
   - Amount: `15`
   - Payment date: keep today
   - Payment method: **Bank transfer**
   - Reference: `SUP-ADVANCE-2026-08-20-01`
3. Select **Record advance**.
4. In the advance preview select **Apply to payable**.
5. Choose the `SP-...` created above, change **Amount to apply** to `5`, and
   select **Apply advance**.

Expected: the advance shows BGN 10.00 still available. The payable now has
BGN 23.00 remaining and its payment trail shows the BGN 5.00 advance allocation.

## 4. Prepare a matching customer receivable

An offset requires the same partner to be both customer and supplier.

1. From the sidebar choose **ERP → Sales → Quotations → New quotation**.
2. Enter:
   - Customer: **TechSupply Demo Ltd.**
   - Warehouse: **Demo Central Warehouse**
   - Product: **Demo 12 V Power Adapter**
   - Quantity: `1`
   - Unit price: `50`
   - Line discount: `0`
   - VAT: **20% VAT**
   - Overall discount: `0`
   - Currency: `BGN`
3. Select **Create quotation → Preview → Confirm order and reserve stock →
   Complete shipment**.
4. Enter customer representative `TechSupply test contact`, then select
   **Record customer acceptance → Prepare invoice draft**.
5. Go to **ERP → Finance → Collections & payments → Add to collections**.
6. Choose the new TechSupply invoice draft, keep the suggested due date, select
   **Add record**, and note its `FIN-REV-...` number.

Expected: the customer receivable starts at BGN 60.00.

## 5. Offset both partner balances

1. Return to **ERP → Finance → Supplier payables** and preview your `SP-...`.
2. Select **Create offset**.
3. Choose your supplier payable and the new TechSupply `FIN-REV-...`.
4. Enter:
   - Offset amount: `10`
   - Offset date: keep today
   - Reason: `Mutual balance test`
5. Select **Create offset**.

Expected: an `OFF-...` record appears under **Advances & offsets**. The supplier
payable has BGN 13.00 remaining; the customer receivable has BGN 50.00 remaining.

## 6. Match the final outgoing bank payment

1. Choose **Bank reconciliation → New statement**.
2. Enter:
   - Bank name: `Vista Demo Bank`
   - Statement reference: `SUPPLIER-TEST-2026-08-20-01`
   - Company account IBAN: `BG76DEMO00000000000000`
   - Opening balance: `100`
3. For Transaction 1 enter:
   - Direction: **Outgoing**
   - Amount: `13`
   - Dates: keep today
   - Counterparty: **TechSupply Demo Ltd.**
   - Payment reference: `Payment for SP-...` using your exact payable number
4. Select **Use calculated balance**. Expected closing balance: BGN 87.00.
5. Select **Add statement → Preview → Review match**.
6. Keep **Match a payable**, select your `SP-...`, and choose
   **Confirm supplier match**.

Expected: the outgoing line becomes **Matched**, the statement becomes
**Reconciled**, and the payable becomes **Paid** with BGN 0.00 remaining. The
unused BGN 10.00 supplier advance remains visible under **Advances & offsets**.

## Current boundary

This test does not cover legal supplier-invoice issuance, deductible-VAT or
general-ledger posting, bank-file import, direct cash-voucher allocation to a
supplier payable, or statutory aging/journal/VAT reports. Those remain pending.
