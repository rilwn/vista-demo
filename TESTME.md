# Check Security panels

Sign in to Vista Operations with your administrator account and authenticator.
These checks do not require changing anyone's access.

1. Select **Administration → Security → Employees**. In **Find an employee**,
   enter `crm@vista.local`, then select **Manage**.
2. Check the employee details and sign-in protection. Under **Assigned roles**,
   search for `Warehouse`, then clear the search. Existing selections should
   remain unchanged. Scroll down: **Close / Save roles** must stay visible,
   edge-to-edge at the bottom. Select **Close** without saving.
3. Select **Roles → Add role**. Search for `Service` under **Find a module**.
   Check the aligned permission checkboxes, then select **Cancel**.
4. Find an existing role and select **Edit access**. Check its current selections,
   then select **Cancel** without saving.
5. Switch to **BG** and narrow the window. Repeat the employee and role-panel
   checks. Only the panel body should scroll; its heading and actions stay visible.
   Press **Escape** to close, then switch back to **EN**.

# Check System activity and Recovery panels

Run locally with `npm run dev`. Use `platform.manager@vista.local` for Operations
and `backup.administrator@vista.local` for Recovery. Enter each account's
authenticator code if prompted.

1. In Operations, open **Administration → System activity** and open an event.
   Check its status, copyable reference and delivery steps. Scroll the details;
   the panel heading stays visible. For a failed delivery with a receiver, choose
   **Retry delivery**; its confirmation stays in the bottom bar. Cancel it. An
   event with no receiver must not offer retry.
2. Switch to **BG**, narrow the window, and reopen an event. Check that the
   details remain inside the right panel. Press **Escape** to close.
3. In Vista Recovery, open **Policies & schedules → Create policy**. Check the
   fields and source checkboxes; scroll the form and confirm its bottom actions
   stay visible. Select **Back** without saving.
4. Open **Policy approvals** and **Restores & approvals**. Review any available
   cards and confirm their status, notes, decision buttons and recovery controls
   are aligned. Do not approve or decline a request during this visual check.

# Check Business structure panels

Sign in to Vista Operations as `manager@vista.local`. These checks do not
require saving or changing business records.

1. From the sidebar, select **Administration → Business structure**.
2. Select **Edit** beside **Vista Demo Ltd.** The form should open at the
   right edge, not above the company cards. Check the aligned fields, then
   press **Escape**. Focus should return to **Edit**.
3. Select **Location**. Make the browser window narrow, then scroll through
   the form. The heading and bottom **Cancel / Add location** buttons should
   stay visible, with no gap below the footer. Select **Cancel** without saving.
4. In the existing location card, select the **registers / operators** counts.
   Check the expanded rows, then select **Edit** for the cash register. Check
   that operator checkboxes and names are aligned. Select **Cancel**.
5. Switch to **BG**, reopen **Обект**, and repeat the scrolling check. Select
   **Отказ** without saving, then switch back to **EN**.

# Test a DATECS offline cash sale

Only run with the connected DATECS FP-2000 in its manufacturer-approved
training/test mode. Do not issue a customer or production receipt for this test.

1. Open Vista POS, sign in as `pos.operator@vista.local`, and open the assigned
   cashier shift while online.
2. Choose **Sell**. Add **Demo 12 V Power Adapter** and one other in-stock
   catalog item marked **Standard item**. Leave the customer blank; use quantity
   `1` for each item, no discounts, and cash payment.
3. In Chrome DevTools, open **Network** and change **No throttling** to
   **Offline**. Complete the sale and confirm DATECS prints one receipt with
   both items.
4. Open **Sale history**. Confirm the receipt is listed as waiting to sync.
5. In DevTools, change **Offline** back to **No throttling**. Confirm the same
   receipt appears in Sale history once and its status changes to recorded.

# Send and complete a customer feedback survey

Run locally with `npm run dev`. Sign in to Vista Operations as
`manager@vista.local`.

1. Open **Customers & CRM → Customer care → Feedback & NPS**.
2. Select **Send survey**. Choose the completed service job
   **DEV-WO-FIN-0001** and its listed customer email, then select **Send survey**.
3. Open Mailpit at `http://localhost:8025`. Open the new Vista feedback email and
   follow its private link.
4. On the survey page, choose **9**, optionally enter a short comment, and
   submit. Switch **БГ / EN** to check both languages.
5. Reopen the same email link. Confirm it says the response was already
   recorded and does not offer a second submission.
6. Return to **Customer care → Feedback & NPS**. Confirm the survey shows one
   response with score `9` and the NPS response count increased by one.

The local email is captured by Mailpit, not sent to the customer. For a contact
without an email address, add one under **Customers & CRM → Partners → Preview →
Contacts** before sending.

# Follow a completed Service charge through payment

Run locally with `npm run dev`. Sign in to Vista Operations as
`manager@vista.local`.

1. Open **ERP → Service → Work orders**. Open **DEV-WO-FIN-0001** and confirm
   it shows a recorded customer charge of **EUR 90.00**.
2. Choose **Prepare invoice draft**. Review the customer and lines, then save
   the draft.
3. Confirm the VAT-inclusive invoice total is **EUR 108.00**. Confirm the issue
   prompt and choose **Issue document**.
4. Open **ERP → Finance → Collections & payments**. Find the new invoice and
   record **EUR 108.00**, today's date, **Bank transfer**, reference
   `SERVICE-DEMO-01`.
5. Confirm the balance is **EUR 0.00** and status is **Paid**.
6. Return through **ERP → Service → Work orders**. Reopen **DEV-WO-FIN-0001**;
   confirm its issued invoice link remains available and there is no option to
   create a second invoice.

# Create and print a supplier acceptance protocol

Run locally with `npm run dev`. Sign in to Vista Operations as
`procurement@vista.local` using the local demo credentials.

1. Open **ERP → Procurement → Purchase orders**, then choose **New purchase order**.
2. Select **TechSupply Demo Ltd.**, **Demo Central Warehouse**, and **Demo 12 V
   Power Adapter**. Enter quantity `1`, unit price `60` EUR, and an expected
   delivery date later than today. Save the order.
3. On the order, choose **Receive delivery**. Keep quantity `1`, enter unit cost
   `60` EUR and delivery reference `ACCEPT-TEST-20261026-01`, then receive it.
4. Open **ERP → Procurement → Goods receipts**. On the new delivery, choose
   **Create acceptance protocol**. Leave the invoice unlinked if no invoice is
   available, then create the protocol.
5. Confirm the supplier, warehouse, product, accepted quantity and protocol
   number. Choose **Print / save as PDF**.
6. Close and reopen **View protocol**. Confirm it is the same record. Switch to
   **BG** and confirm the panel is translated.

# Test a collected POS return

Run locally with `npm run dev`. Use the demo accounts and local fiscal simulator.
This does not test DATECS hardware or send an actual repayment.

## One-time permission setup

Recording a repayment needs Finance Approve. If `finance@vista.local` cannot
record it, sign in as `local.admin@vista.local`:

1. Open **Security → Roles → Add role**. Name it `Finance Return Approver`, code
   `finance-return-approver`, and grant **Finance: View** and **Finance: Approve**.
2. Open **Security → Employees**, select **Manage** for `finance@vista.local`,
   assign the new role without removing its existing role, then save.
3. Sign in again as `finance@vista.local`.

## Create, return and reconcile the sale

1. Open Vista POS at `http://localhost:5174` and sign in as
   `pos.operator@vista.local`.
2. Choose **Shifts**. Enter opening cash `100`, then **Open cashier shift**.
3. Choose **Sell**. Search `DEV-ADAPTER-12V` and add one **Demo 12 V Power
   Adapter**.
4. In **Current sale**, choose **Add customer**. Search `Alfa`, select
   **Alfa Market Demo Ltd.** and **Alfa Market · Central Store**, then **Use
   customer**.
5. Choose **Advance / account**. Set **Use from advance** to `0` if shown. Choose
   **On account**, then **Complete sale**. Select **Prepare invoice** and note
   the sale number.
6. In Vista Operations at `http://localhost:5173`, sign in as
   `finance@vista.local`. Open **Finance → Financial documents**, preview the new
   draft, confirm the review checkbox and **Issue document**.
7. Open **Finance → Customer accounts**. Preview Alfa Market, find that sale and
   choose **Collect payment**. Enter `10`, today's date, **Bank transfer**, and
   reference `DEMO-POS-COLLECTION-01`. Confirm and **Record payment**.
8. In Vista POS, choose **Returns**. Find that sale, select **Start return**,
   select the adapter, keep the full quantity, and complete the return.
9. In Operations, return to **Finance → Customer accounts → Preview** for Alfa.
   Find the return. Confirm it shows the unpaid amount released and the collected
   amount still owed back. Choose **Prepare credit note**, review it, then
   **Issue document**.
10. Back on the customer account, choose **Record repayment**. Enter `10`,
    today's date, **Bank transfer**, reference `DEMO-POS-REPAY-01`; confirm the
    customer has received it, then record it.
11. Confirm the repayment appears once in the return history and the amount still
    owed is `0`. Reopen the invoice and confirm its original total is unchanged.
12. In POS, choose **Shifts**. Count cash as `100` and **Close cashier shift**.
    The recorded bank repayment must not change the POS drawer.

If a different collection amount is used, repay that exact amount instead of
`10`. For a return with no issued invoice, a credit note is not required. Switch
to **BG** and repeat the account preview at phone width to check the translation
and panel layout.

## Review invoice and POS payment status

Run locally with `npm run dev`. Sign in as `finance@vista.local`.

1. In Vista Operations, open **Finance → Customer accounts**.
2. In **Payment status**, search `Alfa`. Confirm it includes issued invoices and
   customer POS sales, including paid POS invoices, with total, paid, outstanding
   and due-date details. An issued POS invoice appears once, with its receipt number.
3. Choose a status such as **Partially paid**, then **All statuses**. Confirm the
   results update without leaving the page.
4. Select **Next** and **Previous** when more than one page is available.
5. Select **Review** on a row. Confirm the customer account opens and the linked
   invoice or POS balance is still available.

## Offset a supplier payable against a POS account sale

Run locally with `npm run dev`. Use the demo accounts. This records an internal
offset; it does not move cash or issue a bank payment.

1. In Vista Operations at `http://localhost:5173`, sign in as
   `manager@vista.local`. Open **Finance → Customer accounts → Set payment terms**.
2. Select **TechSupply Demo Ltd.** Turn on **Allow on-account payment**. Set the
   credit limit to `200`, due after `14` days, **Valid from** today, and status
   **Active**. Save.
3. Open **Finance → Supplier payables**. Select **Add supplier invoice**, choose
   `DEV-SUP-VAT-001 · TechSupply Demo Ltd.`, keep the suggested due date, and
   select **Add payable**.
4. Open Vista POS at `http://localhost:5174` and sign in as
   `pos.operator@vista.local`. Open a cashier shift if needed.
5. Choose **Sell**. Add one **Demo 12 V Power Adapter**. In **Current sale**,
   choose **Add customer**, select **TechSupply Demo Ltd.**, then choose **On
   account** and **Complete sale**. Note the sale number and balance.
6. In Operations, return to **Finance → Supplier payables → Payable register**.
   Preview the payable and choose **Create offset**.
7. Select the POS sale under **Customer balance**. Enter `5` as the offset amount,
   today's date, and reason `Demo POS account offset`. Select **Create offset**.
8. Open **Advances & offsets**. Confirm the offset shows the POS sale and supplier
   payable. Preview the supplier payable and TechSupply customer account; confirm
   each outstanding balance is lower by exactly `5.00 EUR`.

## Offer extended warranty or a Service plan

Run locally with `npm run dev`. Sign in to Vista Operations as
`manager@vista.local`.

1. Open **Customers & CRM → Customer care → Warranties** and open an active
   warranty card, for example **DEV-WCR-0001**.
2. Choose **New coverage offer**. Select **Extended warranty**, enter `240` EUR,
   set the start date to the day after the current warranty ends, set validity to
   30 days from today, and enter `Coverage includes parts and labour.`
3. Choose **Save offer**. Reopen the warranty card and confirm the offer shows
   the device, serial, price, dates and terms. Choose **Print offer** to review
   the customer copy.
4. Choose **Mark as shared**, then **Record acceptance**. Confirm the accepted
   offer remains on the same warranty card after closing and reopening it.

This records the customer's decision only. It does not issue an invoice or
activate a contract. Repeat in **BG** to check the translated labels.

# Book and track a courier delivery

Run locally with `npm run dev`. Sign in to Vista Operations as
`manager@vista.local`. Econt or Speedy credentials must first be configured in
the environment; otherwise the courier choices stay unavailable and this live
test must be skipped.

1. Open **ERP → Logistics → Deliveries**, then select **Plan delivery**.
2. Select an available Sales shipment and its customer location. Set a delivery
   time later today, choose the connected courier, and enter recipient
   `Ivan Petrov`, phone `+359888123456`, parcel count `1`, and weight `2.500 kg`.
   Save the delivery.
3. Open the new delivery and select **Book Econt** or **Book Speedy** once.
   Confirm it shows a courier tracking number and booking status.
4. Select **Refresh tracking**. Confirm the latest courier scan and time appear
   in the delivery history. Refresh again and confirm the same scan is not
   duplicated.
5. If the booking says **Needs review**, do not book again. Check the courier
   account for the shipment linked to the Vista delivery number, enter its
   tracking number in **Verify and reconcile**, and confirm. Then refresh
   tracking.

If provider credentials are unavailable, adapter and API recovery behavior is
covered by the automated local tests; no live courier shipment should be
created.

# Import a Bulgarian bank statement

Run locally with `npm run dev`. Sign in to Vista Operations as
`finance@vista.local`.

1. Open **ERP → Finance → Bank reconciliation**, then choose **New statement**.
2. Upload `docs/qa/fixtures/finance-bank-import-camt053.xml` from the project
   folder. Confirm the account, statement reference, dates, EUR 100.00 opening
   balance, EUR 160.00 closing balance, and one EUR 60.00 incoming transaction.
3. Choose **Use these transactions**, enter **Demo Bank**, then choose
   **Add statement**. Open the statement and confirm its transaction is available
   for review and the balance is EUR 160.00.
4. Repeat with `docs/qa/fixtures/finance-bank-import-mt940.sta`. Confirm the same
   totals and that reference `DEMO-MT940-INV-001` is shown.
5. Switch to **БГ** and confirm the import instructions and file errors are in
   Bulgarian.

These files contain synthetic demo data only; no money is moved. If you import a
sample again, review any duplicate warning before matching it.

# Record a disaster-recovery test

Run locally only after `BACKUP_RESTORE_DATABASE_URL` points to a separate,
isolated PostgreSQL test target with permission to create and remove test
databases. Use the same `BACKUP_ENCRYPTION_KEY` used for the selected backup.
Never point it at the live Vista database. Have one verified database restore
point and two MFA-enabled Recovery users: `backup.administrator@vista.local`
and `security.officer@vista.local`.

1. Sign in to **Vista Recovery** as `backup.administrator@vista.local`.
2. Open **Jobs & restore points**. Confirm a database backup is **Verified**.
3. Open **DR tests** → **Plan DR test**. Select that restore point, choose a
   future date, and enter: `Restore the Vista database in isolation and verify
customer and sales records.` Select **Plan test**.
4. Open **Restores & approvals**. Sign in as
   `security.officer@vista.local`, find the request marked with the DR-test
   code, and select **Approve restore**. The requester cannot approve their own
   restore.
5. Return to **DR tests** and refresh until the isolated restore shows a final
   result. Do not continue while it is pending or running.
6. Sign back in as `backup.administrator@vista.local`. Select **Record test
   result**. Enter the actual minutes observed for RPO and RTO, what was checked,
   any issues and corrective actions. Attach the signed test-protocol PDF and
   save.
7. Confirm the register shows the measured result and signer. Select **Download
   signed protocol** and confirm the file opens. On **Overview**, confirm the
   latest signed test result and measured times are shown.

# Record the annual backup-plan review

Run locally with `npm run dev`. Use the `security.officer@vista.local` account
and complete its authenticator setup in Vista Operations if prompted.

1. Sign in to **Vista Recovery** and open **Plan review**.
2. Check the listed protected sources, backup policies, owners, and storage
   target against the approved Information Backup Plan.
3. Select **Record review**. Choose **Reviewed; plan is current** and enter:
   `Checked active sources, schedules, retention and storage target.` Select
   **Save signed review**.
4. Confirm the page shows **Review current** and the history contains your name,
   decision, next review date, and saved plan snapshot.

The entry cannot be edited or deleted. Reminder deduplication, changed-plan,
and overdue cases are covered by automated tests.

# Pause and resume a backup schedule

Run locally with `npm run dev`. Have an active schedule and two MFA-enabled
Recovery accounts: `backup.administrator@vista.local` and
`security.officer@vista.local`.

If there is no active schedule, create one first as the backup administrator:
under **Sources & inventory → Add source**, enter source code `LOCAL-DB`, name
`Vista local database`, source type **Database**, classification **Critical**,
and location `Local PostgreSQL`. Then under **Policies & schedules → Create
policy**, enter code `LOCAL-HOURLY`, name `Local database schedule`, type
**Database snapshot**, frequency **Hourly**, RPO `60`, RTO `240`, select the
source, and save. Request approval, approve it as the security officer under
**Policy approvals**, then activate the schedule as the backup administrator.

1. Sign in as `backup.administrator@vista.local`. Open **Policies & schedules**,
   choose an active schedule, select **Request pause**, enter
   `Pause for a scheduled recovery review.`, and submit. Confirm it remains
   active while awaiting review.
2. Sign in as `security.officer@vista.local`. Open **Restores & approvals** and
   confirm the request is labelled **Pause backup schedule**. Select **Decline**.
   Confirm the schedule remains active.
3. As the administrator, request the pause again. As the security officer,
   approve it. Confirm the schedule changes to **Paused**.
4. Sign back in as the administrator. In **Policies & schedules**, select
   **Resume schedule** and confirm it returns to **Active**.

The requester cannot approve their own pause. No backup data is deleted by this
test.

# Request a lower backup retention limit

Run locally with `npm run dev`. Use an active or paused schedule and two
MFA-enabled Recovery accounts: `backup.administrator@vista.local` and
`security.officer@vista.local`.

1. As `backup.administrator@vista.local`, open **Policies & schedules** and
   choose **Request lower retention** on a schedule showing `35` daily and `12`
   monthly copies.
2. Enter `30` daily, `10` monthly, and the reason `Reduce the archive window
after reviewing recovery needs.` Select **Send for approval**.
3. Confirm the schedule still shows `35` and `12`, with the request awaiting
   review.
4. Sign in as `security.officer@vista.local`. Open **Policy approvals**, check
   the old and proposed counts, and select **Approve**.
5. Sign in again as the administrator and confirm the schedule now shows `30`
   daily and `10` monthly copies.

The requester cannot approve the change. Rejection or expiry leaves the prior
counts in place; eligible old copies are removed only by retention processing,
while run history and audit evidence remain.
