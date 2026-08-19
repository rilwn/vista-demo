# User Guides and Built-in Help

User manuals and built-in help are written with each executable workflow. Module
empty states do not present sample records as real behavior.

## ERP/CRM employee access

1. Open the ERP/CRM web application and enter the email and password assigned to
   the employee account.
2. If the account has an enrolled second factor, enter the current six-digit code
   when the focused verification step appears.
3. The application validates the new or restored session with the API before it
   opens the workspace. A new sign-in always opens the permission-safe Overview,
   rather than restoring a page left in browser history by another employee.
   Navigation shows only modules granted by the current backend permissions.
4. Use **My access** to inspect effective module/action permissions, manage an
   authenticator app, change your password, or sign out.

Every page opened from a module hub has a previous-page control above its page
heading, such as **Back to Sales** or **Back to Warehouse**. It always returns to
the correct module hub, including when the nested page was opened directly.
Record previews and forms use their own **Back** control to return to the
unchanged register.

To change a password, open **My access → Change password**. The panel shows the
currently configured requirements. Enter the current password and the new
password twice. A successful change keeps this browser session active and signs
out every other session using the account. Recently used passwords are rejected;
the form never sends the confirmation value or displays stored password data.

Locked, expired-password, rate-limited, enrollment-required, invalid-credential,
password-policy, password-reuse, and unavailable-service responses have distinct
recovery messages. If an employee cannot sign in, a two-factor-verified
administrator must first verify the employee’s identity, issue a short-lived
recovery handoff from **Administration → Security**, and share its one-time code
through an approved channel. The employee then opens **Use a recovery code** on
the sign-in screen, enters the verified work email, code, and a new password.
All existing sign-ins are closed. An administrative account must set up and
verify a new authenticator before it can sign in again. Direct email or SMS
recovery delivery is not enabled until the approved provider adapters are live.

### Authenticator app

To add a second factor to a standard employee account, open **My access → Set up
authenticator**. Confirm the current password, add the displayed one-time setup
key to a time-based authenticator app, and enter its current six-digit code. The
factor is not active until that code is accepted. On subsequent sign-ins the same
six-digit code is required after the password.

To remove an enrolled factor, use **My access → Remove authenticator** and
confirm both the current password and a current authenticator code. The action
signs out every other active session and is audited. Administrative accounts
must retain an enrolled factor; an employee should enroll their factor before
being assigned an administrative role.

When no administrative account exists, an authorized deployment owner can run
the one-time `npm run iam:provision-initial-admin` command with the documented
`INITIAL_ADMIN_*` settings. It creates the minimal bootstrap administrator only
when no administrative assignment exists, displays an authenticator setup key
once, records the event in the audit chain, and refuses all later runs. Add that
key to an authenticator app before the first sign-in, then remove the temporary
enable flag and password from the environment.

### Security

Employees granted `platform:view` can open **Administration → Security**. The page
uses live data and separates Employees, Roles, Sessions, and Activity log into
focused views.

- `platform:create` allows a user to add an individual employee account and
  construct a role from the controlled module/action permission matrix.
- `platform:approve` allows version-checked role assignment, reversible account
  disable/reactivation, and session revocation. Disabling an account terminates
  all its active sessions.
- Administrative roles can only be created or assigned by an administrative
  user whose current session passed 2FA, and the receiving account must already
  have an enabled factor. The final active administrator is protected from
  removal, and users cannot disable themselves.
- A two-factor-verified administrative user can select an active employee,
  choose **Issue recovery handoff**, record the identity-verification note, and
  share the displayed code through an approved channel. The code is shown once,
  expires quickly, and cannot be used after completion, replacement, or
  revocation.
- The Activity log shows material events and the independently recomputed chain
  result. A failed result is a security incident to investigate, not a control to
  dismiss or rewrite.

The interface never reveals passwords, password hashes, session token digests,
or stored factor secrets. A one-time setup key is visible only during initial or
recovery factor setup, and a recovery code is visible only when the authorized
administrator issues it.

### Notifications

Select the bell in the top bar to open your delivered operational notifications.
Unread updates are marked when opened; the system never exposes another employee's
notifications. The first connected notification is the low-stock alert, which
shows the available and configured minimum quantity. Email and SMS delivery remain
dependent on the approved provider configuration and are not represented as sent
until that adapter is live.

### Platform job operations

Employees granted `platform:view` can use the operations integration/API to see
queue counts and the lifecycle of a known background-job identifier. The view is
deliberately payload-free and read-only: it cannot reveal queued customer data or
modify/replay/delete jobs. A dedicated operational console remains part of the
remaining Phase 1 operations work.

### Local fixture accounts

For local browser testing, configure these values in the untracked `.env` file:

```dotenv
DEV_FIXTURES_ENABLED=true
DEV_FIXTURES_PASSWORD=ChooseYourOwn!2026
```

Then start the development environment with `npm run dev`. In development mode,
the startup sequence prepares the local fixture set after migrations. It requires
an explicit opt-in and a loopback PostgreSQL URL, but that is a safeguard rather
than proof that data is isolated: never use it with shared, staging, or
production credentials or data. Re-running normal local startup preserves
user-edited operational records and completed test work; it does not reset
passwords or business documents. It reconciles only the dedicated fixture-role
grants after confirming those roles and accounts have no unexpected assignments.
The only compatibility repair replaces the former invalid fixture
EAN/IBAN literals on their fixed fixture IDs; it leaves any edited value
untouched.

Replace the shown password with a private value that meets the configured
password policy before using this outside a disposable local environment.
If a reserved demo identifier belongs to another record, startup stops the
fixture transaction without applying a partial setup.

The configured `DEV_FIXTURES_PASSWORD` value is used when an account is first
created. Changing it later deliberately does not reset credentials. Sign in to
the ERP/CRM application with the account that matches the workflow you want to
test.

| Account                        | Use it for                                                                  |
| ------------------------------ | --------------------------------------------------------------------------- |
| `manager@vista.local`          | Broad review of currently implemented non-administrative ERP/CRM workflows. |
| `platform.manager@vista.local` | Business structure and read-only Security review.                           |
| `crm@vista.local`              | Partner, location, contact, and equipment records.                          |
| `warehouse@vista.local`        | Catalog, warehouse, stock, reservation, and traceability work.              |
| `procurement@vista.local`      | Procurement records and receiving.                                          |
| `sales@vista.local`            | Sales, pricing, handover, and subscriptions.                                |
| `finance@vista.local`          | Collections and payment allocation.                                         |
| `dispatcher@vista.local`       | Service requests and dispatch.                                              |
| `technician@vista.local`       | Assigned Service work and completion.                                       |
| `pos.operator@vista.local`     | POS sign-in and terminal-shell review only.                                 |
| `backup.operator@vista.local`  | Backup Control sign-in and console-shell review only.                       |
| `viewer@vista.local`           | Read-only ERP/CRM review outside restricted Service work.                   |

The fixture accounts are intentionally non-administrative because administrative
roles require a configured second factor. POS and Backup Control now use the
same authenticated session controls as ERP/CRM, but their operational workflows
remain unavailable. Signing in confirms access control and the controlled shell;
it does not test selling, fiscalization, backup jobs, restore, or DR operations.

## Business structure

Employees with `platform.organization:view` can open **Business structure** from
the Administration navigation group. The page shows the live hierarchy and never
fills an empty system with example branches or registers.

Employees with `platform.organization:create` follow the dependency-aware setup
order:

1. Add the internal legal business entity with its unique code and optional UIC
   and VAT number.
2. Add one or more branches under that entity.
3. Add physical operating locations with configurable type and address.
4. Assign active employee accounts as location operators.
5. Add cash registers and optionally assign same-location operators.

Unavailable steps remain disabled until their parent exists. Every submission is
safe to retry unchanged. The warehouse setup screen can optionally attach a
warehouse to one of these locations and, for technician custody, to an operator
at the same location. Current operations create records only; moving,
deactivating, or editing the topology is not yet available.

## Shared partner registry

Employees with `crm:view` can open **Customers & CRM** to use the shared partner
registry. Search matches name, UIC, or VAT number; the adjacent controls filter by
business role and legal-entity/individual type. Select a name to inspect the
record identifier, addresses, contacts, and bank accounts.

Employees with `crm:create` also see **Add partner**:

1. Select legal entity or individual and enter the registered/full name.
2. For a legal entity, enter known UIC, VAT number, and company representative.
3. Select at least one role. A partner can be a customer, supplier, and business
   partner at the same time.
4. Submit once. Network retries reuse the same command key while the form remains
   unchanged, preventing duplicate posting.

If an exact normalized legal-company name or UIC already exists, creation stops
and the existing record reference is shown. There is intentionally no merge or
override control: resolution authority and merge rules require decision
`CRM-002`. Individual display names may repeat because a name is not an identity.

Employees with `crm:edit` can add an address, contact, or bank account from the
partner profile. Addresses need type, first address line, city, and country;
contacts need a name plus telephone or email; bank accounts require a valid IBAN.
The API normalizes this information and safely replays a failed network retry
without adding the record twice. Employees with `crm:edit` can also use **Edit
partner** to maintain the partner's type, legal details, representative, and
roles. The save is version-checked so a newer colleague change is never silently
overwritten. Profile child records cannot yet be edited or merged.

Employees with `crm:delete` can deactivate a partner, but only after every
customer location is inactive. This preserves the record and history; it is not
a hard delete. An employee with `crm:edit` can reactivate it later. Duplicate
resolution and partner merge remain deliberately unavailable pending `CRM-002`.

For a partner carrying the customer role, the profile also includes **Customer
locations & equipment**. Employees with `crm:view` can inspect each site and its
installed-device register. Employees with `crm:edit` can:

1. Add a location with its customer-facing name, configurable type, address, and
   an optional responsible contact already registered to that customer.
2. Add equipment at that location with its device name, unique serial, purchase
   date, warranty dates, and current status (`Active`, `Under repair`, or
   `Retired`).
3. Edit the location's operational details or a device's name, dates, and status.
   The serial and catalog-product identity stay read-only after registration.
4. Deactivate equipment before deactivating its location; reactivate the
   location before reactivating equipment. Inactive records remain visible as
   history rather than disappearing.

The warranty indicator derives from the stored date and never invents a warranty
where no end date was entered. A serial already known to warehouse inventory is
linked by the API; legacy or external equipment remains unlinked and is still
clearly registered. Maintenance is version-checked and retry-safe. Location and
equipment deactivation requires `crm:delete`; reactivation and edits require
`crm:edit`. Hard deletion, moving devices between locations, and identity changes
are not available.

## Product categories

Employees with `erp.warehouse:view` can open **Warehouse** to see the configured
product-category hierarchy. It starts empty by design: the screen does not claim
that an example category is an approved Vista catalog value.

Employees with `erp.warehouse:create` can select **Add category**, give it a name,
optionally choose an existing parent, and select its stock tracking policy:
quantity only, unique serial numbers, or batches. **Require an expiry date** is
available only for batch tracking. Choose the policy that matches the products in
that category; it drives receiving, reservation, shipment, and stocktake evidence.
A retry of an unchanged save is safe; duplicate normalized names under the same
parent are blocked.

## Product catalog

Employees with `erp.warehouse:view` can open **Warehouse → Product catalog** to
view the shared product and unit registers. The screen uses actual API data and
starts empty until the business configures its own records.

Employees with `erp.warehouse:create` can add units and products. A product needs
a unique code, a configured category, and a configured unit; optional typed
barcodes must be unique across the catalog. If a network save is retried unchanged,
the original command is reused rather than creating another record. Inventory,
prices, serialised items, batches, expiry records, and stock movements are not
available in this screen yet.

## Warehouse inventory operations

Open **Warehouse** and use the operations strip to move between Warehouses, Stock,
Movements, Stocktakes, and Reservations & trace. The screens use current API data;
they do not insert sample balances or predict whether a command will pass server
validation.

Employees with `erp.warehouse:create` can configure a standard or technician
warehouse and post an idempotent stock receipt. A serial-tracked product requires one serial per
whole received unit; a batch-tracked product requires a batch number, and an
expiry-tracked batch also requires its expiry date. Receipts must not be used to
imitate transfers, issues, stocktake adjustments, or reservation releases because
each has its own audited workflow.

Select **Movements → Issue** to post a stock issue for a sale, repair, or write-off.
The requested quantity must exist in the selected warehouse. Serialised products
need currently available serials; once issued, those serials cannot be issued
again. Batch products require the source batch. Returns and valuation remain
unavailable until their dedicated controlled workflows are delivered.

An authorized transfer moves stock between two different configured warehouses.
The source must have the requested quantity, selected batch, and/or available
serials. A successful transfer updates both warehouses together; it must not be
recorded as a receipt plus a separate issue.

Select **Stocktakes** to open one warehouse count, record every stocked product, include
the exact serials and per-batch quantities where applicable, then ask a user with
`erp.warehouse:approve` to complete it. Receipts, issues, transfers, and new
reservations are paused for that warehouse while the count is open. Missing
serials are quarantined as missing; the system never silently substitutes another
serial. A count cannot reduce physical stock below active reservations.

Select **Movements → Return** to restore warehouse custody. Enter the UUID of the
original stock issue, choose the destination and whether the item is returning to
ordinary or service stock, and scan all required serials. The system rejects an
unrelated issue, an already returned serial, or a cumulative quantity above the
original issue. Posting this warehouse movement does not by itself reverse the
customer's fiscal receipt, invoice, card transaction, or payment.

Select **Reservations & trace** to commit quantity to a sales order, quotation, or service request.
Serial-tracked products require the exact serials. Unrelated issues and transfers
cannot consume reserved stock. A matching issue may partially or fully consume a
reservation; users with `erp.warehouse:edit` may release the unconsumed remainder.
The reservation history remains available after consumption or release.

Receipts may include a BGN unit cost. The system recalculates the warehouse's
weighted-average unit cost automatically; issues, transfers, and stocktake
adjustments retain that valuation trail. If cost is omitted, the receipt is
recorded explicitly at BGN 0.0000 and should be corrected through an approved
source workflow rather than an invented value.

The **Stock** screen shows physical, reserved, and available quantities plus
weighted-average cost and BGN inventory value. Users with `erp.warehouse:edit`
can configure minimum and target quantity for a product in a warehouse. The
replenishment register compares the minimum against available quantity after
active reservations. When stock is low, its purchase recommendation is the
quantity required to reach the configured target. Leave **Alert me when stock
reaches the minimum** selected to register the signed-in employee explicitly.
One in-system message is queued for each low-stock cycle, without repeated alerts
until stock first recovers. Queue dispatch is active for in-system delivery.
Optional FIFO remains disabled until selected.

Open **Warehouse → Reservations & serial trace**, then scan or enter a serial.
The result shows product, current custody/status, supplier receipt, transfers,
customer issue, linked return, technician, references, and actors in time order. Missing party
evidence is shown as absent rather than invented; unknown serials remain a clear
not-found state.

## Purchase orders and goods receipts

Open **Procurement → Purchase orders** to review current orders or start an
order. Select an active supplier, currency, and expected delivery date, then add
one or more products with quantities and unit prices. A product can appear only
once on an order. The displayed order reference is an internal reference until
Vista approves its official numbering sequences.

Open an order and choose **Receive goods** to record a partial or final delivery.
Choose the destination warehouse and enter only the quantity received now. For
serial-tracked products, scan one serial per whole unit. For batch-tracked
products, enter the batch and required expiry date. BGN orders use their order
price as inventory cost; foreign-currency orders require the actual BGN unit cost
used for warehouse valuation.

After posting, confirm the order comparison shows the updated received and
remaining quantities. **Procurement → Goods receipts** shows the receipt history,
and **Warehouse → Stock** shows the resulting quantity and weighted-average BGN
cost. A replay of the same submission is safe; an attempt to receive more than
the ordered quantity is rejected.

### Supplier records, invoices, and claims

Use the visible application navigation; no address or route needs to be entered.
From the left navigation, choose **ERP → Procurement**. The Procurement landing
page presents the available areas, and the same tabs remain visible after one is
opened.

- Choose **Suppliers** to review commercial terms, contacts, and evaluation
  history. Select **Preview supplier** to open the right-side record preview. Use
  **Back** or the close control to return to the unchanged supplier list. Users
  with edit permission can save payment/delivery terms or append an evaluation.
- Choose **Supplier invoices**, then **Record supplier invoice**. Select the
  purchase order, enter the supplier's invoice number and date, and compare each
  line's ordered, delivered, and already-invoiced quantities before recording.
  Select **Preview** on a recorded invoice to inspect the three-way comparison;
  use **Back** to return to the register.
- Choose **Supplier claims**, then **New supplier claim**. Select the exact
  received product, damaged or non-conforming type, affected quantity, and
  description. Preview a claim to see its complete status timeline and advance it
  through Submitted, Resolved, and Closed. The system prevents claims above the
  received quantity.

These invoice records are purchasing evidence and comparison controls. They do
not post VAT, accounting, payment, or correction documents; those actions will
be performed through the finance workflow.

### Quotation to invoice draft

Use only the visible application navigation:

1. From the left navigation, choose **ERP → Sales**, then select **Quotations**.
2. Select **New quotation**. Choose the customer, dispatch warehouse, validity
   date, and currency. Add products, quantities, discounts, and VAT. Select
   **Use customer price** on a product line when you want to apply the active
   customer/group/campaign price; the returned price remains editable until the
   order is confirmed. Save the quotation.
3. Select **Preview** on the saved quotation. Review the totals and stage timeline,
   select the required serial numbers for serialized products, then select
   **Confirm order**. Stock is reserved at this point.
4. In the same preview, choose a batch for every batch-tracked line and select
   **Create shipment**. The preview advances to Shipment and records the warehouse
   issue. It also prepares an equipment handover certificate from the actual
   shipment and serial numbers.
5. In **Equipment handover certificate**, enter the accepting customer
   representative and an optional note, then select **Record customer acceptance**.
6. Select **Prepare invoice draft**. Review the completed timeline and use **Back**
   to return to the register without losing the current list context.

The draft is ready for final review and issuance in Finance. It is not yet a
fiscal or accounting document and must not be sent to a customer as an issued
invoice.

### Finance collections

Use only the visible application navigation:

1. From the left navigation, choose **ERP → Finance**, then select **Invoices**.
2. Select **Add to collections**. Choose a BGN sales invoice draft and set the
   payment due date. The panel shows the customer and collection amount before
   you save.
3. The saved record opens in the right-side panel. Review its source, current
   balance, payment list, and record history. Select **Back** to return to the
   unchanged register.
4. Select **Record payment**. Enter an amount up to the remaining balance, date,
   payment method, and an optional reference or concise note. Save the payment.
   The panel returns to the record with the updated balance and status.
5. Select **Back**, then open **Payments & allocations** above the register to
   review the same customer record from the payment view.

This workflow records BGN collection activity only. It does not issue a legal or
fiscal invoice, post VAT/accounting entries, calculate BNB rates, import or match
bank statements, or send payment reminders.

### Prices and promotions

Use only the visible application navigation:

1. From the left navigation, choose **ERP → Sales**, then select
   **Prices & promotions**.
2. Open **Customer groups** and select **Add customer group**. Enter a stable code
   and name, select the customers, and save.
3. Open **Campaigns** and select **Add campaign**. Enter its code, name, and
   effective dates, then save.
4. Open **Price lists** and select **Add price list**. Choose whether it applies to
   all customers, a group, or one customer; select the currency and period;
   optionally link the campaign; set the priority; and enter each product price.
5. Use **Check price** to choose a customer, product, date, and currency. The
   result shows the exact list that would apply. A higher priority wins; when
   priorities tie, an individual price wins over a group price, which wins over
   an all-customer price.
6. Select **Edit** to correct future behavior or make a list, group, or campaign
   inactive. Existing quotations and documents keep their saved values.

### Service subscriptions

Use only the visible application navigation:

1. From the left navigation, choose **ERP → Sales**, then select
   **Service subscriptions**.
2. Select **New contract**. Choose the customer and service location. If a location
   has no available device, go to **Customers & CRM → Partner registry**, preview
   the customer, and add the location/equipment before returning to Sales.
3. Select the covered devices. Add one included service per line and choose the
   visit frequency.
4. Set the contract start/end dates, next invoice date, recurring amount,
   currency, and billing frequency, then select **Create contract**.
5. Select **Preview** to review coverage, equipment serials, service frequency,
   billing schedule, and generated draft history. Use **Edit contract** for a
   version-checked correction or to make the contract inactive.
6. Use **Back** in the right-side panel to return to the unchanged register, or
   **Back to Sales** above the page to return to the Sales areas.

Recurring billing drafts appear after the scheduled billing task processes a due
date. They remain review drafts until Finance performs approved legal issuance.

## Service work

The development fixtures provide an active customer location and device, a
dispatcher, a technician mapped to a technician warehouse, and optional stocked
parts. Test the complete Service core with two browser sessions (for example, a
normal window and a private window), using visible application navigation only:

1. In the first browser session, sign in as `dispatcher@vista.local`. From the
   left navigation, choose **ERP → Service**, open **Service requests**, and
   select **New service request**. Select an active fixture customer, location,
   and device; use **Out of warranty** for a straightforward first run; add the
   source, priority, and problem; then save.
2. In the request preview, select **Dispatch request**. Choose the fixture
   technician, select a visit time, and choose **Assign visit**. The generated
   work order is now assigned to that technician. Use **Back** to return to the
   unchanged request register.
3. In the second browser session, sign in as `technician@vista.local`. Choose
   **ERP → Service → Work orders**; the technician view shows only work assigned
   to that account. Open the work order created by the dispatcher. Select
   **Start work**. If useful, select a valid JPEG, PNG, or WebP file and choose
   **Upload photo**. Dispatch, rescheduling, and cancellation stay with the
   dispatcher or another approving service role.
4. Select **Complete work**. Enter completion notes, working time, labor and
   transport costs, and optionally a stocked fixture part. Serial- or
   batch-tracked parts require their matching evidence. Enter the customer
   representative, draw a signature, and select **Complete work**.
5. Before leaving the completed work-order panel, verify the uploaded photo and
   signature there. Use **Back** to return to the work-order details, then
   **Back** again to the register. Open **Equipment history** and select the same
   active device to verify the completed service event, technician, and used
   parts. Evidence is intentionally reviewed from the completed work order, not
   from the history list.

To test a warranty or subscription request, choose the fixture device with the
corresponding active coverage. Do not use an expired warranty or a device without
a matching active subscription; the API correctly prevents that request.

The current Service workspace is intentionally limited to the documented core:
manual source capture, dispatch, technician work, stock deduction, evidence, and
service-only history. It does not yet create a payment document, service invoice,
warranty card or claim, inspection reminder, subscription visit, CRM ticket/SLA,
route plan, or full sales/supplier serial history.
