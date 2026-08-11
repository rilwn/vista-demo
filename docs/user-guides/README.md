# User Guides and Built-in Help

User manuals and built-in help are written with each executable workflow. Module
empty states do not present sample records as real behavior.

## ERP/CRM employee access

1. Open the ERP/CRM web application and enter the email and password assigned to
   the employee account.
2. If the account has an enrolled second factor, enter the current six-digit code
   when the focused verification step appears.
3. The application validates the new or restored session with the API before it
   opens the workspace. Navigation shows only modules granted by the current
   backend permissions.
4. Use **My access** to inspect the effective module/action permissions for the
   current session, change your password, or sign out.

To change a password, open **My access → Change password**. The panel shows the
currently configured requirements. Enter the current password and the new
password twice. A successful change keeps this browser session active and signs
out every other session using the account. Recently used passwords are rejected;
the form never sends the confirmation value or displays stored password data.

Locked, expired-password, rate-limited, enrollment-required, invalid-credential,
password-policy, password-reuse, and unavailable-service responses have distinct
recovery messages. Password reset and factor enrollment/recovery are not
implemented yet and require the remaining P1.3 flows.

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
- The Activity log shows material events and the independently recomputed chain
  result. A failed result is a security incident to investigate, not a control to
  dismiss or rewrite.

The interface never reveals passwords, password hashes, session token digests,
or factor secrets. Password reset and 2FA enrollment/recovery controls are still
pending and are not simulated by this screen.

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

### Local browser testing

The repository does not contain a shared password. After applying migrations,
create a development-only account with a password chosen on your machine:

```sh
DEV_SEED_EMAIL='dev@vista.local' DEV_SEED_PASSWORD='choose-a-strong-local-password' npm run db:seed:dev
```

Then open `http://localhost:5173/login` and use that email and password. Re-running
the command safely resets this local account's password and clears failed-login
lockout state. The command refuses to run with `NODE_ENV=production`.

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
and optionally choose an existing parent to form the hierarchy. A retry of an
unchanged save is safe; duplicate normalized names under the same parent are
blocked.

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
