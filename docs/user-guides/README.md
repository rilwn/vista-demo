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

## Shared partner registry

Employees with `crm:view` can open **Customers & CRM** to use the shared partner
registry. Search matches name, UIC, or VAT number; the adjacent controls filter by
business role and legal-entity/individual type. Select a name to inspect the
record identifier and currently available master-data fields.

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
Editing, deleting, merging, contacts, addresses, bank accounts, customer
locations, and equipment are not yet available in this slice.
