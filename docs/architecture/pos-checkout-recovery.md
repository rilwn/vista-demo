# Interrupted POS checkout recovery

Scope: AGENTS.md §8.3, §8.6 and §11; initial Phase 7 work, not offline-sale acceptance.

- Before a sale POST, IndexedDB atomically saves the exact request and its stable
  transaction ID, scoped to the signed-in employee. A second unresolved request
  cannot overwrite it, including across browser tabs. Storage failure stops the POST.
- No password, access token or card/PIN details are saved. The request contains
  product/customer identifiers and payment amounts, so shared terminals still need
  protected browser/OS access. Account scoping is not encryption or an XSS boundary.
- Success clears only the matching transaction. Network and uncertain failures
  retain it. Recognized validation/business rejections release it for correction.
- Throughout the signed-in terminal, a read-only, employee-scoped lookup checks the transaction.
  Reconnect and ten-second checks retrieve an already completed sale, including
  after shift closure. Unknown IDs never reveal another employee's sale.
- If unconfirmed, only the cashier's explicit retry resends the saved request,
  with its original transaction ID and idempotency key. Server pricing, inventory,
  authorization and payment validation remain in force; no offline conflict winner
  is inferred. Read and submit timeouts preserve uncertain requests.
- Browser/site storage can be cleared or evicted. Do not clear it during recovery.
  Loading the application still requires connectivity. Recovery runs across every
  POS route. The footer shows the current employee's pending count on this browser;
  Recovery shows their latest 50 local events and links confirmed transactions back
  to authorization-scoped server receipts. The existing saved request survives the
  IndexedDB version-2 upgrade. Events and checkout resolution commit atomically.
- Local events record saving, interruption, explicit retry, confirmation and
  rejection without credentials or payment details. They persist across reloads,
  are not editable through the app, and are account-scoped, but browser owners can
  alter/delete site data: this is operational history, not tamper-resistant audit.
  Server-backed retry/conflict audit remains pending; the server's existing sale,
  stock, fiscal and payment audit remains authoritative.
- Same-window events, cross-tab messages and focus rechecks keep status current.
  Unavailable cross-tab messaging cannot turn a committed write into a failure.
  Local pending checkout checks disable shift closure and recheck storage before
  submitting a close command. This is a local safety guard, not a server policy
  covering unknown requests on other browsers or devices.
- Offline queue execution, approved POS-002 conflict rules, centralized history
  and certified target fiscal-hardware acceptance remain Phase 7 work.

Checks: IndexedDB commit-before-send, storage failure, cross-tab overwrite guard,
account separation, lost response, reload/reconnect recovery, explicit stable-ID
retry, API permissions/UUID validation, closed-shift lookup, duplicate sale replay
and stock conservation. Certified hardware effects are not covered by simulator tests.
