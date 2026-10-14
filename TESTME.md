# EUR currency check

Use the local apps after restarting with `npm run dev`. No database reset or
reseeding is needed; the migration converts the existing development data.

## Vista Operations

1. Sign in as `manager@vista.local` and open **Finance → Financial documents**.
2. Select **New financial document**. Choose **Invoice**, **Manual document**,
   **Vratsa Service & Retail Centre**, **Alfa Market Demo Ltd.**, and
   **Demo Fiscal Register X1**.
3. Keep quantity `1`, discount `0`, and **Standard 20%**. Confirm the currency
   defaults to **EUR**, and `BGN` is not offered.
4. Confirm the net price is **€306.7751**, VAT is **€61.3550**, and the total is
   **€368.1301**. Save as a draft, open **Preview**, and confirm it still shows
   EUR. Close the panel.

## Vista POS

1. Sign in as `pos.operator@vista.local` and open **Sell**.
2. Search for **Demo Fiscal Register X1**. Confirm its price is **€306.7751**.
   Do not complete a sale.

Expected: both apps use EUR for new amounts. Existing local demo balances and
prices have been converted, and the app does not offer or post BGN.

# Operations QA fixes

Run these checks on **localhost only**. Use `manager@vista.local` for ERP/CRM,
`procurement@vista.local` for purchasing, `warehouse@vista.local` for stock,
`sales@vista.local` for Sales, `dispatcher@vista.local` for Service intake,
`technician@vista.local` for assigned jobs, and `local.admin@vista.local` for
mandatory administrator two-factor sign-in. Use the account's existing
authenticator code; do not reset or disable it for this check.
When repeating a flow, use a new date/time suffix for statement, invoice, and
serial references; the system correctly rejects duplicate references.

## Sales document, collection and payment correction

1. In **Sales → Quotations**, create a quotation for **Alfa Market Demo Ltd.**
   with an available **Demo 12 V Power Adapter**. Save it, open **Preview**,
   revise the quantity, and confirm the revision is recorded. Before confirming
   the order, choose **Email quotation** and check that one message arrives in
   local Mailpit, if enabled.
2. From **Preview**, confirm the order, complete shipment, and prepare the
   invoice draft. In **Finance → Financial documents**, create a **Proforma
   invoice** from that prepared Sales draft, keep the currency **EUR**, and
   issue it. Confirm it has no official invoice number yet.
3. Open **Finance → Collections & payments → Add to collections**, select the
   same Sales invoice draft and set a due date one week from today. Record a
   full cash payment. Confirm an official invoice is created and linked to the
   proforma.
4. Open that payment and reverse it with reason `QA correction`. Confirm the
   original payment remains visible and the linked reversal restores the
   outstanding balance.
5. From **Finance → Financial documents**, create and issue a **Credit note**
   for the new invoice with reason `QA price correction`. Confirm the preview
   links to the original invoice. Create a second quotation, download its PDF,
   then cancel it; confirm the first quotation remains unchanged.

## Bank import and Finance exports

1. Open **Finance → Bank reconciliation → New statement**. Enter bank
   `Vista QA Bank`, reference `QA-STMT-20261014`, IBAN
   `BG76DEMO00000000000000`, statement date `2026-10-14`, opening balance `0`,
   and closing balance `2.00`. In **Import a bank file**, upload
   [`finance-bank-import.csv`](docs/qa/fixtures/finance-bank-import.csv).
2. Map the six columns to date, direction, amount, currency, reference and
   counterparty. Confirm EUR is accepted and the duplicate line is flagged for
   review rather than silently matched.
3. Open **Finance → Finance reports → Export report**, choose **Income** or
   **Outcome**, and set a date range including `14 Oct 2026`. Prepare CSV and
   XLSX exports. Confirm unavailable account codes are blank.

## Security and serial trace

1. Sign in to Vista Operations as `local.admin@vista.local`; confirm the
   authenticator code is required.
2. As `procurement@vista.local`, create a purchase order for one
   **Demo Fiscal Register X1** from **TechSupply Demo Ltd.** Use unit cost
   `250.00 EUR`, warehouse **Demo Central Warehouse**, and serial
   `QA-FR-20261014-01`. Receive the item.
3. In **Procurement → Supplier invoices**, select that purchase order. Record
   invoice `TS-QA-20261014-01`, date `2026-10-14`, quantity `1`, unit price
   `250.00 EUR`, and **Standard 20%** VAT.
4. Create a second purchase order for the same product at `275.00 EUR` and
   receive serial `QA-FR-20261014-02`. Confirm a 10% cost warning appears but
   receipt is allowed.
5. As `sales@vista.local`, sell the first serial to **Alfa Market Demo Ltd.**
   through quotation, order, shipment and handover. Record a return against the
   sale and send it to Service.
6. As `dispatcher@vista.local`, open a Service request for that serial; assign
   it to `technician@vista.local`. As the technician, complete the work and
   record a repair note. Open **Service → Equipment history** and confirm the
   supplier receipt, sale, handover, return and technician repair appear in
   order.

## Service charges and CRM SLA

1. In **Service → Service requests**, open a warranty job and record customer
   labour charge `20.00 EUR` and, if a part is available, use one listed part.
   Confirm transport cannot be added to the warranty charge. For an
   out-of-warranty job, enter labour charge `20.00 EUR`, internal labour cost
   `12.00 EUR`, and transport cost `5.00 EUR` separately; confirm only customer
   charges are prepared for Finance.
2. In **Customers & CRM → Tickets**, open a ticket and confirm it shows the
   Sofia weekday response and resolution targets. Record the first response and
   confirm the response timer stops and the ticket timeline records the event.
