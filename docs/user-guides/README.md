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
   current session and **Sign out** to revoke it.

Locked, expired-password, rate-limited, enrollment-required, invalid-credential,
and unavailable-service responses have distinct recovery messages. Password reset,
factor enrollment/recovery, account administration, and approved initial accounts
are not implemented yet and require an administrator or the pending P1.3 flows.

### Local browser testing

The repository does not contain a shared password. After applying migrations,
create a development-only account with a password chosen on your machine:

```sh
DEV_SEED_EMAIL='dev@vista.local' DEV_SEED_PASSWORD='choose-a-strong-local-password' npm run db:seed:dev
```

Then open `http://localhost:5173/login` and use that email and password. Re-running
the command safely resets this local account's password and clears failed-login
lockout state. The command refuses to run with `NODE_ENV=production`.

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
without adding the record twice. Existing records cannot yet be edited, merged,
deactivated, or deleted. Customer locations and equipment are also not yet
available in this slice.

## Product categories

Employees with `erp.warehouse:view` can open **Warehouse** to see the configured
product-category hierarchy. It starts empty by design: the screen does not claim
that an example category is an approved Vista catalog value.

Employees with `erp.warehouse:create` can select **Add category**, give it a name,
and optionally choose an existing parent to form the hierarchy. A retry of an
unchanged save is safe; duplicate normalized names under the same parent are
blocked. Products, units, barcodes, tracking, and stock are not available yet
because their policy and initial data require `CAT-001` and `BUS-001`.
