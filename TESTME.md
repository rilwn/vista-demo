# Test now — ERP/CRM local fixture flows

This is the current, browser-ready test pack. It is replaced when the next
meaningful milestone is ready; it is not a project backlog or history.

## Start and sign in

1. In the private `.env`, set `DEV_FIXTURES_ENABLED=true` and a policy-compliant
   `DEV_FIXTURES_PASSWORD`.
2. Run `npm run dev`, then open `http://localhost:5173`.
3. Sign in with any fixture account below using the password that was set when
   the fixture accounts were first created.

Every new sign-in must land on **Overview**, never on a previous employee's
page. If you changed `DEV_FIXTURES_PASSWORD` after the accounts already existed,
their passwords intentionally remain unchanged.

Use a unique suffix such as `TEST-20260817-1530` for new records. Use the
visible **Back** actions; do not type internal routes.

## 1. Customer and equipment

Sign in as `crm@vista.local`.

1. Go to **Customers & CRM → Partner registry → Add partner**.
2. Use **Legal entity**, name `TEST Customer <suffix>`, and select **Customer**.
   Leave UIC and VAT number empty for this first test.
3. Save, then in the new profile add:
   - Address: `1 Test Street`, `Vratsa`, `BG`.
   - Contact: `Test Contact <suffix>`, `test@example.invalid`.
   - Customer location: `TEST Outlet <suffix>` with the same address.
   - Equipment: `TEST Fiscal Device`, serial `TEST-SERIAL-<suffix>`, status
     **Active**, purchase date today, and a warranty end date one year ahead.

Expected: the partner, location, and device remain visible in the profile after
using **Back**. To check duplicate protection, try creating `Alfa Market Demo
Ltd.`; it must be blocked rather than merged.

## 2. Purchase order and partial receipt

Sign in as `procurement@vista.local`.

1. Go to **ERP → Procurement → Purchase orders → New purchase order**.
2. Select supplier **TechSupply Demo Ltd.**, warehouse **Demo Central Warehouse**,
   currency **BGN**, delivery date tomorrow, and product **Demo 12 V Power
   Adapter**.
3. Set quantity **2** and unit price **45.00**, then save.
4. On the new order select **Receive delivery** and receive quantity **1**.
5. Open **Goods receipts**.

Expected: the order shows **Part received** and the receipt appears in the
register. Use that same received line for a supplier invoice or claim only after
the receipt exists.

## 3. Pricing, sales, and collection

Sign in as `sales@vista.local`.

1. Go to **ERP → Sales → Prices & promotions → Check price**.
2. Select customer **Balkan Retail Demo Ltd.**, product **Demo 12 V Power
   Adapter**, currency **BGN**, and today. The result should be **BGN 45.00**
   from **Demo retail BGN prices**.
3. Go to **Quotations → New quotation** and select:
   - Customer: **Balkan Retail Demo Ltd.**
   - Warehouse: **Demo Central Warehouse**
   - Currency: **BGN**
   - Validity date: a date after today
   - Product: **Demo 12 V Power Adapter**
   - Quantity: **1**, discount: **0**, VAT: **20%**
4. Select **Use customer price**, save, open **Preview**, then select:
   **Confirm order and reserve stock → Complete shipment → Record customer
   acceptance → Prepare invoice draft**. Enter `Test Receiver <suffix>` for the
   customer representative.

Then sign in as `finance@vista.local`.

5. Go to **ERP → Finance → Invoices → Add to collections** and select the draft
   you just created. Set a due date after today and save.
6. Open it, select **Record payment**, enter **10.00**, choose **Cash**, and
   save.

Expected: the draft is linked to a collection record and its outstanding balance
falls by BGN 10.00.

## 4. Service: dispatcher to technician

Use a normal window for the dispatcher and a private/incognito window for the
technician.

Dispatcher: sign in as `dispatcher@vista.local`.

1. Go to **ERP → Service → Service requests → New service request**.
2. Select:
   - Customer: **Alfa Market Demo Ltd.**
   - Location: **Alfa Market — Central Store**
   - Device: **Demo Fiscal Register X1 · DEMO-FR-ALFA-01**
   - Source: **Telephone**
   - Priority: **Normal**
   - Service type: **Out of warranty**
   - Problem: `TEST-SERVICE-<suffix>: printer feed check`
3. Save, open the preview, select **Dispatch request**, choose **Vista Demo
   Service Technician**, select a future visit time, then choose **Assign visit**.

Technician: sign in as `technician@vista.local` in the private window.

4. Go to **ERP → Service → Work orders**. Only assigned work should be visible.
5. Open the newly assigned order and select **Start work**.
6. Select **Complete work** and enter:
   - Completion notes: `Printer feed checked and operating normally.`
   - Work date: today; minutes: **30**
   - Labour cost: **30.00**; transport cost: **0.00**
   - Customer representative: `Test Receiver <suffix>`
   - Draw a signature in the signature box
7. Select **Complete work**.

Expected: the order reaches **Completed**. The completed drawer shows the
signature and cost. **Equipment history** shows the service event. Do not test
payment documents, warranty claims, inspection scheduling, routes, or CRM tickets
from this screen; they are not ready yet.

## What is intentionally not in this test pack

- POS and Backup Control operational workflows.
- Legal/fiscal invoicing, VAT/accounting, bank import, reports, and exports.
- Password reset, 2FA enrolment/recovery, and Security administration changes.
- Warehouse returns and stocktakes.
- CRM leads, tickets/SLA, customer portal, warranty claims, and analytics.
- Service payment documents, inspection visits, routes, and complete sale/supplier
  serial history.
