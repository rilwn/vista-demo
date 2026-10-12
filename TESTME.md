# Finance QA: prices, subscription billing and payment dates

Use local/demo data in **Vista Operations** at http://localhost:5173.
Restart with `npm run dev` to apply migration `0067`. Sign in as
`manager@vista.local` with your existing password and select **EN**.

## 1. Use a customer price

1. Sidebar: **Finance → Financial documents → New financial document**.
2. Choose **Invoice**, **Manual document**, location **Vratsa Service & Retail
   Centre**, customer **Alfa Market Demo Ltd.**, and product **Demo Fiscal Register X1**.
3. Keep today's dates, `BGN`, quantity `1`, discount `0`, and **Standard 20%**.
   Expected: unit price fills with `600.0000`; total is **BGN 720.00**.
4. Enter price `650`. Select **Use customer price**. Expected: price returns to `600.0000`.
5. Change currency to `EUR`. Expected: no matching price message and an empty
   price field, not an invented zero or converted price. Close without saving.

`finance@vista.local` can also complete this flow without Sales access.

## 2. Review a subscription billing period

If Sales already shows a billing draft, start at step 4. To create one immediately
on localhost, temporarily set this line in `.env`, then restart `npm run dev`:

```dotenv
SALES_SUBSCRIPTION_INVOICE_CRON=*/10 * * * * *
```

This speeds up the local test only. Do not change the hosted schedule.

1. Sidebar: **Sales → Service subscriptions → New contract**.
2. Choose **Alfa Market Demo Ltd.**, the service location containing **Central Store**,
   and the checkbox for **Demo Fiscal Register X1**. Keep included services and
   coverage frequency. Set **Starts on** and **Next invoice date** to today,
   **Recurring amount** to `120`, currency `BGN`, billing frequency **Every month**.
3. Select **Create contract**. Note its number. After ten seconds, reload the page
   and select **Preview** beside that contract. Expected: one recurring billing draft.
4. Beside the billing draft, select **Open in Finance**. Expected: its saved
   charge and customer are filled in. Keep the demo issuing location, today's
   document date, default due date and **Standard 20%**.
5. Select **Prepare draft**. Expected: **BGN 120.00 net**, **BGN 24.00 VAT**,
   **BGN 144.00 total**, with the subscription billing reference in the preview.
6. Close and reload. Under **Subscription billing**, that period now offers
   **Preview**, not **Review billing**. Open it: the same Finance draft reopens.
7. Close the panel and select **BG** in the top bar. Expected: subscription
   labels, actions, dates and amounts use Bulgarian. Select **EN** to switch back.

After the local test, restore the previous `SALES_SUBSCRIPTION_INVOICE_CRON`
value (default `0 15 1 * * *`) and restart. These remain review drafts, not issued invoices.

## 3. Reject a future payment

1. Sidebar: **Finance → Customer payment accounts → Record advance**.
2. Choose **Alfa Market Demo Ltd.**, **Amount (BGN)** `1`, **Method** **Bank transfer**,
   **Date received** `2099-12-31`, and **Payment reference** `QA-FUTURE-01`.
3. Select **Record advance**. Expected: a future-date message; no advance is saved.
   Close the panel. The same date guard applies to collection and supplier
   payments, bank matching and offsets; those paths have automated API checks.

## 4. Apply an advance to a customer balance

1. In Vista Operations, open **Finance → Customer payment accounts**. Select
   **Preview** for **Alfa Market Demo Ltd.**
2. Under **Open receivables**, find **DEV-FIN-REV-0001** with **BGN 40.00** due.
   Select **Apply advance**.
3. Select **DEV-ADV-ALFA-001** and leave the suggested amount **BGN 40.00**.
   Select **Apply advance**.
4. Open **Finance → Collections & payments**, find **DEV-FIN-REV-0001**, and
   select **Preview**.

Expected: the collection is **Paid**; its payment history shows **Advance from
DEV-ADV-ALFA-001**. In Customer payment accounts, that receivable is no longer
open and **BGN 40.00** remains available on the advance. This sample requires
the untouched local demo balances shown above.

## 5. Open the Sales source from Finance

1. With `manager@vista.local`, open **Finance → Collections & payments**.
2. Find **DEV-FIN-REV-0001**, select **Preview**, then select **Open in Sales**.
3. Confirm the Sales panel shows **DEV-Q-0001** and invoice draft
   **DEV-INV-DRAFT-0001**. Select **Back to Finance** in the panel header.

Expected: you return to **Collections & payments**. The Finance preview's Sales
link is shown only to users who can view Sales.

## 6. Check registration-number validation

Use the local demo app and leave both forms unsaved.

1. Open **Administration → Business structure → Add legal entity**.
2. Enter code `QA-ORG-01`, name `QA Identifier Check Ltd.`, UIC `12AB`, and VAT
   number `XYZ`. Select **Add legal entity**.
3. Expected: both identifier fields show clear errors and no entity is added.
   Close the form without saving.
4. Open **Customers & CRM → Partners → Add partner**. Enter name
   `QA Identifier Check Ltd.`, keep **Company**, enter UIC `12AB` and VAT number
   `XYZ`, then select **Add partner**.
5. Expected: both identifier fields show errors and no partner is added. Close
   the form without saving.

## 7. Edit and restore a business-structure record

1. In Vista Operations, sign in as `manager@vista.local` and open
   **Administration → Business structure**.
2. Select **Legal entity**. Enter a unique code such as `QA-ORG-02-1009` and
   name it `QA Structure Check 1009 Ltd.`. Select **Add legal entity**.
3. Select **Edit** on the new record. Change its name to
   `QA Structure Check 1009 Ltd. Updated`, then select **Save changes**.
4. Select **Deactivate** and confirm. Expected: the record is labelled
   **Inactive** and remains in the structure.
5. Select **Reactivate**. Expected: **Inactive** disappears and **Deactivate**
   is available again. Leave the test record active.

## 8. Review role access

1. In Vista Operations, sign in as `local.admin@vista.local` and complete the
   authenticator step. Open **Administration → Security → Roles**.
2. Find **Manager**. Confirm its description is specific. Select **Edit access**;
   confirm the five actions **View, Create, Edit, Delete, Approve** are shown.
3. Close that panel. Select **Add role**. Enter **QA limited access** and code
   `qa.limited`. Select **POS → Approve**. Expected: a warning says the role
   cannot open POS screens without **View**. Select **POS → View**; the warning
   should disappear. Select **Cancel** without saving.
4. Reopen **Manager → Edit access**. Confirm **POS → View** and **Approve** are
   selected, while **Create** and **Edit** are not. Select **Cancel**.

## 9. Check role and sign-in labels

1. Sign in as `manager@vista.local`. In the top-right account menu, confirm the
   role reads **Manager**, not **Standard employee**. Sign out.
2. Try signing in once as `manager@vista.local` with an intentionally incorrect
   password. Then sign in as `local.admin@vista.local` and enter its authenticator
   code.
3. Open **Administration → Security → Sessions**. Confirm the tab says how many
   sessions are **active**; older revoked or expired sessions remain in the list.
4. Open **Activity log**. Confirm the failed sign-in names the attempted account.
   Switch the top-bar language to **BG** and confirm these labels are Bulgarian.

## 10. Trace an installed device

1. In Vista Operations, open **ERP → Warehouse → Reservations & serial trace**.
2. Enter `DEMO-PRINTER-ALFA-01` and select **Trace serial**.

Expected: the device opens under its customer location and its recorded Service
events appear in the timeline, even though it is not a current stock item.
The page must not claim supplier/receipt history unless that source is linked.

`DEMO-FR-ALFA-01` currently has no linked receipt/stock source in the local demo
data. Its equipment lookup can be checked, but it cannot yet demonstrate the full
supplier-to-sale trace requested in QA.

## 11. Reserve stock against a real quotation

1. Open **ERP → Sales → Quotations → New quotation**. Choose **Alfa Market Demo
   Ltd.**, **Demo Central Warehouse**, a future validity date, **Demo 12 V Power
   Adapter**, quantity `1`, unit price `50`, and standard 20% VAT. Save and note
   the quotation number; do not confirm it.
2. Open **ERP → Warehouse → Reservations & serial trace**. Keep the same
   warehouse/product, choose **Sales order**, enter `NONEXISTENT-SO-999`, set
   quantity `3`, then select **Create reservation**.
3. Expected: a clear message says the reference was not found; the form keeps
   its values and no reservation is added.
4. Change **Reference type** to **Quotation**, enter the quotation number from
   step 1, set quantity `1`, and select **Create reservation**.
5. Expected: the quotation appears under **Active reservations** with its
   document number. Refresh the page; confirm it is still listed. Select
   **Release**; confirm it disappears from the active list.

## 12. Review posted stock movements

1. In Vista Operations, open **ERP → Warehouse → Stock movements**.
2. Scroll below the Receive/Issue/Return/Transfer form to **Posted stock
   movements**. Confirm rows show date, movement, product, warehouse, source,
   signed quantity, value and the employee who posted it.
3. Select a warehouse, product, movement type and search for a visible source
   reference. Select **Apply filters**; confirm only matching rows remain.
4. Select a linked source reference. Confirm its Procurement, Sales, Logistics,
   Service or stocktake register opens. References without a linked record stay
   as plain text; internal IDs should not appear.

## 13. Review a receipt-price difference

1. In Vista Operations, open **ERP → Procurement → Purchase orders → New purchase order**.
2. Choose **TechSupply Demo Ltd.**, **Demo Central Warehouse**, **BGN**, and
   **Demo 12 V Power Adapter**. Enter quantity `4`, unit price `12.50`, and a
   future expected-delivery date. Save the order.
3. Select **Receive delivery** on that order. Keep quantity `4`, change **Unit
   cost (BGN)** to `20.00`, and enter delivery reference `QA-COST-01`.
4. Expected: a warning shows the difference and says the entered cost will be
   used for inventory valuation. Select **Receive delivery** to post it.
5. Open **ERP → Warehouse → Stock movements** and search `QA-COST-01`. Confirm
   the receipt shows quantity `4` and value **BGN 80.00**.

The warning does not block posting. Approval rules and foreign-currency price
comparison are awaiting the client's decision.

## 14. Check stock valuation total

1. In Vista Operations, open **ERP → Warehouse → Stock**.
2. Compare **Inventory value** with the sum of the displayed line values.

Expected: the total equals the visible line values to the cent.

## 15. Check quotation validity

1. Open **ERP → Sales → Quotations → New quotation**.
2. Set **Valid until** to yesterday. Expected: a date warning appears and the
   browser blocks saving.
3. Set **Valid until** to today or later, then create the quotation.
4. Open **Preview** for any existing quotation whose **Valid until** date has
   passed.

Expected: it is labelled **Expired** and has no **Confirm order** action. If no
expired draft exists locally, the automated API and UI regressions cover this
case without changing demo records.

## 16. Revise and print a quotation

1. In Vista Operations, open **ERP → Sales → Quotations → New quotation**.
   Choose **Alfa Market Demo Ltd.**, **Demo Central Warehouse**, **BGN**, and
   **Demo 12 V Power Adapter**. Enter quantity `1`, price `50`, a validity date
   at least one day from today, then save.
2. Open that quotation's **Preview**, select **Revise quotation**, change the
   quantity to `2`, and save. Reopen Preview and confirm the revised total. Open
   **Revise quotation** again and confirm the form identifies the next revision.
3. Select **Download quotation PDF**. Confirm it opens/downloads as a Bulgarian/English
   commercial quotation and is not labelled as a tax invoice.
4. On the same draft, select **Cancel quotation**, then **Confirm cancellation**.
   Verify the cancelled status and confirm no **Confirm order** action remains.

Availability shown during quotation entry is guidance. Inventory is checked
again when the user confirms an order. Email sending is not available until the
approved sender and delivery provider are configured.

## 17. Use a stocked batch on Service work

1. Sign in to Vista Operations as the Service Technician. From the sidebar, open
   **ERP → Service → Schedule** and open an **In progress** job assigned to you.
2. Select **Complete work**. Under **Parts and costs**, select **Add used part**.
   Choose **Demo Thermal Print Head**, quantity `1`, then choose a batch showing
   at least `1` available. Complete the notes, time, and customer-signature
   fields, then select **Complete work**.
3. Reopen the completed job. Confirm the selected batch is listed under its
   used parts and the job shows completed status.

If no in-progress job or batch option is available, do not submit a different
batch number. Ask a dispatcher to assign a job or replenish the technician
warehouse first. The automated integration test verifies that an unknown batch
is rejected without changing the work order or stock.

## 18. Review a device's full history

1. Sign in to Vista Operations as a Service Dispatcher or Manager with Service
   approval access. Open **ERP → Service → Equipment history**.
2. Select a device that already has a sale, claim or Service record.
3. Confirm its timeline is newest first and shows the event type, source number,
   status and date. Service visits and repairs also show the assigned technician
   and any parts used.
4. Sign in as a Service Technician and open an assigned device's history.
   Confirm only that technician's assigned Service work appears. An unrelated
   device remains unavailable.

## 19. Check overdue Service work

1. Open **ERP → Service → Schedule**. Find a scheduled or in-progress visit
   whose appointment end time has passed. Expected: it is marked **Overdue**.
2. Open **ERP → Service → Warranty & inspections**. An active inspection due
   before today's Sofia date is marked **Overdue**; one due today is marked
   **Due today**.
3. Confirm that viewing these labels does not change the visit or inspection
   status.

If no existing record meets those dates, leave demo data unchanged; the isolated
regression tests cover the overdue and due-today cases.

## 20. Review CRM ticket SLA history

1. In Vista Operations, open **Customers & CRM → Tickets** and open a ticket
   with an approaching or missed response/resolution deadline.
2. In its preview, open **SLA history**.
3. Confirm each entry names the deadline, recipient, time, and notification
   delivery state. Escalation recipients appear as separate entries.

If no ticket has SLA history, do not change its dates. Isolated API and browser
regressions cover alerts, escalation, delivery and retry safety.

## 21. Review customer locations and equipment

1. In Vista Operations, sign in as `manager@vista.local`. Open **Customers & CRM
   → Locations & equipment** and search for **Alfa Market Demo Ltd.**
2. Select **Locations and equipment**. Confirm its registered location and
   installed devices appear.
3. On a device, select **Service history**.

Expected: Service opens with that same device selected. Use **Back** to return
to the customer register. This is a read-only check; do not add or edit records.

## 22. Confirm equipment status follows Service work

1. Complete **17. Use a stocked batch on Service work** with a customer device.
2. In Vista Operations, open **Customers & CRM → Locations & equipment**, find
   the same device, and confirm its status changed from **Under repair** to
   **Active** after completion.
3. While a Service job is scheduled or in progress, try changing that device's
   status or deactivating it. Expected: the change is blocked with an explanation.

Retired devices remain available in history but cannot receive new Service work.

## 23. Resolve a CRM ticket from completed Service work

1. In Vista Operations, open **Customers & CRM → Tickets** and open a ticket
   linked to a Service request. Select **Open Service**.
2. In **ERP → Service → Schedule**, open that request's assigned work order,
   select **Start work**, then **Complete work** with the required notes and
   customer confirmation.
3. Return to **Customers & CRM → Tickets** and reopen the same ticket.

Expected: the linked ticket is **Resolved**, its history names the completed
Service request, and the Service link remains the same. Reopening or retrying
the link must not create another ticket or resolution entry.

## 24. Review the unified customer timeline

1. Sign in to Vista Operations as `manager@vista.local`. Open **Customers & CRM
   → Interactions & tasks** and choose **Alfa Market Demo Ltd.**
2. Review the timeline. Expected: CRM interactions and tasks appear alongside
   linked tickets, Service requests, Sales quotations, and customer payments,
   newest first. Entries without a specific location are labelled **Customer
   account**.
3. Open a ticket entry. Expected: its ticket preview opens. If your account
   cannot view Sales, Service or Finance, entries from those modules are hidden.
   Payment amounts and references are not shown in the CRM timeline.

## 25. Verify warranty cards after a serial sale

1. In Vista Operations, open **ERP → Sales → Quotations → New quotation**.
   Choose **Alfa Market Demo Ltd.**, **Demo Central Warehouse**, and a
   serial-tracked device with an available serial number. Save the quotation.
2. Open **Preview → Confirm order**, choose the listed serial, complete the
   shipment, then accept the handover.
3. Open **Customers & CRM → Customer care → Warranties**. Search for that serial.

Expected: one warranty card shows the same customer, serial and coverage dates.
Refresh and confirm the card still appears once. If the register shows a notice
that sold serials are missing cards, select **Reconcile register**; confirm the
notice clears and the cards appear. Do not delete or edit records to create a
test gap.

## 26. Record customer feedback after a delivery or Service visit

1. Finish step 25 through an accepted handover, or use a completed Service job.
2. In Vista Operations, open **Customers & CRM → Warranty, feedback & referrals**,
   then **Feedback & NPS**.
3. Under **Completed work awaiting a survey**, select **Prepare survey** beside
   the accepted handover or completed Service job.
4. Share the displayed question with the customer by phone or another approved
   contact method. Select **Record invitation shared**.
5. Open the new survey, enter the customer's actual score from `0` to `10`, add
   their comment if offered, then select **Save response**.

Expected: the work leaves the waiting list, the response appears in the survey
register, and NPS updates. Recording an invitation does not send an email.

## 27. Check lead telephone validation

1. In Vista Operations, open **Customers & CRM → Leads & pipeline → New lead**.
2. Enter a company and contact name. In **Telephone**, enter `abc`, then move
   focus away from the field.

Expected: a clear format message appears and **Save lead** stays unavailable.
Replace it with `+359 888 200 300`; the message clears and the lead can be saved.
Numbers from other countries are accepted using the same 7–15 digit rule.

## 28. Link a quotation before marking it sent

1. In Vista Operations, open **Customers & CRM → Leads & pipeline → Sales
   pipeline**.
2. Open an opportunity with **No quotation**. Set **Next stage** to
   **Quotation sent**.

Expected: the panel explains that a Sales quotation must be linked and keeps
**Update stage** unavailable. Create or find a quotation for that customer,
return to the opportunity, select **Link quotation**, then update the stage.

## 29. Review POS reports with Manager and cashier access

1. In Vista Operations, sign in as `manager@vista.local`, open **Reports →
   Report library**, then select **Open reports** on the POS row.
2. Sign in to Vista POS as `manager@vista.local`. Review **Shifts, Cashiers,
   Products, Categories, Payments, Locations**, and **Compare locations**.

Expected: reports load for the Manager, and CSV, Excel, and PDF export controls
are unavailable. In a separate POS browser session, sign in as
`pos.operator@vista.local`; open **Reports** and confirm report export controls
are available. Do not create an export just for this check.

## 30. Check Bulgarian CRM pipeline labels

1. In Vista Operations, use the top-right language control to select **BG**.
   Open **Customers & CRM → Leads & opportunities → Sales pipeline**.
2. Check the translated descriptions and source choices. Open **Sales pipeline**;
   review the stage names and open an opportunity to inspect its status and
   history.
3. Select **EN** in the same language control.

Expected: the stages use Bulgarian forms such as **Квалифицирана**,
**Изпратена оферта**, **Спечелена**, and **Загубена**. Descriptions, source
choices, counts, history and dates follow the selected language. English
returns when **EN** is selected. Customer names and record numbers do not change.

## 31. Check localized dates, amounts and VAT

1. In Vista Operations, select **BG** in the top-right language control.
2. Open **Finance → Financial documents** and preview a saved document with a
   BGN amount and VAT line. Then open **Reports → Report library** and preview a
   report containing dates and amounts.
3. Open the notification bell and review a due-payment reminder, if one is
   present. Select **EN** and review the same views again.

Expected: Bulgarian uses Bulgarian date and decimal separators; English uses
English separators. Currency codes, values, VAT rates and saved dates stay the
same. This checks display only and does not create or change records.

## 32. Check record references and copy controls

1. In Vista Operations, sign in as `local.admin@vista.local` and open
   **Administration → System activity**. Open an event.
2. If an event marked **Awaiting an integration** is present, open it. Confirm
   the details explain that no receiver is configured and that **Retry** is
   unavailable. Do not create or retry an unsupported event just for this check.
3. Confirm its ID and request reference are not printed as UUID text. Select
   each copy icon and paste into a temporary local note; then close the note.
   If a notification error occurs during normal use, record its displayed
   error code and copyable support reference for the support team; do not
   trigger an outage for this check.
4. Sign in as `procurement@vista.local`. Open
   **ERP → Procurement → Purchase orders** and check an existing order. Confirm
   supplier, warehouse and date identify it; use the copy icon only if its full
   technical ID is needed. Open **Goods receipts** and check an existing receipt.
5. In Vista POS, open **Recovery** if a saved checkout is already present.
   Confirm its transaction ID is hidden until copied.

Expected: the screen uses readable business context and never shows shortened
UUIDs as document numbers. If a purchase order has no client-approved number,
do not create one for this test. No records need to be changed.

## 33. Check tablet tables and record panels

1. In Chrome, open the responsive device toolbar and set the viewport to
   `768 × 1024`.
2. In Vista Operations, open **Reports → Report library**, then open a
   Procurement report. Drag the report table's bottom scrollbar to the right.
3. Open **Customers & CRM → Partners**. Scroll the partner table sideways, open
   **Alfa Market Demo Ltd.**, and scroll its panel to the bottom.
4. Open **Customers & CRM → Leads & pipeline → Sales pipeline**. Scroll the
   six-stage board sideways, open an opportunity, and scroll its panel down.

Expected: only the table/board scrolls sideways, the page does not gain a
sideways gap, and each panel stays within the screen while its content scrolls.

## 34. Search records and check form guidance

1. From **Overview**, use the top search field to find **Alfa Market Demo Ltd.**
   Open the result, then press **Esc**. Expected: the partner opens and the
   panel closes.
2. Search **DEV-FIN-REV-0001** and open the Finance collection record. Press
   **Esc**. Search **DEMO-FR-ALFA-01** and open its serial trace.
3. Open **Customers & CRM → Leads & opportunities → Leads & pipeline → New
   lead**. Enter company `QA validation check`, contact `QA User`, and email
   `not-an-email`, then select **Save lead**.

Expected: the form shows a clear inline email error without saving. Correct it
to `qa@example.invalid`, then select **Back** so no test lead is created. Search
labels and results should follow the selected **EN/BG** language.
