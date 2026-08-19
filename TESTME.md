# Test bank reconciliation

This tests only the completed manual BGN statement and customer-payment matching
flow.

## Start

1. Run `npm run dev` and wait until the API and ERP/CRM app are ready.
2. Open `http://localhost:5173` and sign in as `finance@vista.local` using your
   configured `DEV_FIXTURES_PASSWORD`.
3. From the sidebar, choose **ERP → Finance → Collections & payments**.
4. Preview `DEV-FIN-REV-0001`. On a fresh fixture database it has **BGN 40.00
   remaining**. Select **Back**.

## Enter and reconcile the statement

1. Select the **Bank reconciliation** tab, then **New statement**.
2. Enter:
   - Bank name: `Vista Demo Bank`
   - Statement reference: `TEST-STATEMENT-2026-08-19-01`
   - Company account IBAN: `BG76DEMO00000000000000`
   - Statement date: keep today
   - Opening balance: `1000`
3. For transaction 1, enter:
   - Direction: **Incoming**
   - Amount: `15`
   - Transaction date / value date: keep today
   - Counterparty: `Alfa Market Demo Ltd.`
   - Payment reference: `Payment for DEV-FIN-REV-0001`
4. Select **Add line**, then scroll to the new, empty **Transaction 2** card.
   Enter these values in that second card—not in Transaction 1:
   - Direction: **Incoming**
   - Amount: `25`
   - Transaction date / value date: keep today
   - Counterparty: `Alfa Market Demo Ltd.`
   - Payment reference: `August customer transfer`
5. Select **Use calculated balance**. Closing balance must become `1040.0000`.
   Select **Add statement**.

Expected: the statement opens with transaction 1 **Matched** and
**Reference matched automatically**. Transaction 2 shows **Needs review**.

6. On transaction 2, select **Review match**, choose `DEV-FIN-REV-0001`, and
   select **Confirm match**.
7. Select **Back**, then open **Collections & payments** and preview
   `DEV-FIN-REV-0001`.

Expected: the statement is **Reconciled**; the collection is **Paid**, its
remaining balance is **BGN 0.00**, and two new bank-transfer payments are listed.

If that collection is already paid, use another open collection and split its
displayed remaining balance across the two lines. Use its `FIN-REV-...` number in
transaction 1, and set closing balance to `1000 + both transaction amounts`.
Use a new statement reference if the sample reference already exists.

If no open collection exists, create one through the UI:

1. From the sidebar, choose **ERP → Sales → Quotations → New quotation**.
2. Choose **Balkan Retail Demo Ltd.**, **Demo Central Warehouse**, BGN, a future
   validity date, and **Demo 12 V Power Adapter**. Use quantity `1`, price `50`,
   discount `0`, and **Standard 20%** VAT, then save.
3. Preview it and complete **Confirm order and reserve stock → Complete shipment
   → Record customer acceptance → Prepare invoice draft**. For acceptance, enter
   customer representative `Test customer`.
4. Return through the sidebar to **ERP → Finance → Collections & payments**,
   select **Add to collections**, choose that new Sales draft, keep a future due
   date, and save. Note the new `FIN-REV-...` number and displayed remaining
   balance.
5. Use that number in transaction 1. Split the displayed balance between the two
   statement lines, and make the closing balance `1000 + the displayed balance`.

## Not ready yet

- Bank statement file import
- Supplier-payment matching, advances, and offsets
- Cash vouchers and daily cash reports
- Legal/accounting posting and statutory reports
