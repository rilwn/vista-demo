# Verify help and deployment preparation

Completed verification. No new business records are needed.

1. Sign in to **Vista Operations** with your warehouse account. Select **Help**
   in the top bar, enter `reservations`, and read the stock guide. Finance-only
   guidance should not appear. Press **Escape** to return to your unchanged page.
2. Sign in to **Vista POS**. Select **Help**, search `offline`, then select
   **Back to work**. The guide must distinguish checkout recovery from full
   offline selling.
3. Sign in to **Vista Recovery** with your enrolled authenticator. Select
   **Help**, search `restore`, and confirm the guide clearly states what is not
   operational yet. Narrow the browser: the guide should scroll while its close
   and return controls remain reachable.

For the separate, disposable container check run `npm run test:deployment`.
See [deployment instructions](infrastructure/deployment/README.md) for its scope,
ports and cleanup. This is not a production deployment or Backup/DR test.

## Complete local regression

No manual seed command, password reset or stock change is needed.

From the project folder, with Docker running and Chromium installed:

```sh
# Install once if missing:
sudo apt-get install poppler-utils

PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run test:regression
```

This validates and builds the apps first, then runs the API and browser tests.
Do not start another build or test suite while it is running.
Your normal development data and accounts are not used or changed.

The browser tests follow these flows automatically:

- Sign in, verify an authenticator, recover access and sign out across the apps.
- Procurement: order, receive, record the supplier invoice and compare quantities.
- Sales and Finance: quote, reserve a serial, ship, prepare a draft and collect payment.
- Service: dispatch, complete work, use parts, retain a signature and prepare a draft.
- CRM: qualify and convert a lead, progress an opportunity and link a Service ticket.
- POS: sell, apply approved offers, pay, recover interrupted checkout and return goods.
- Reports and files: save, export, download, retry and check account permissions.

Expected: all checks pass, the latest test-database migration rolls back and
reapplies, and temporary services are removed. Allow several minutes.
If a check fails, share its test name and error, not credentials or tokens.

These checks do not certify fiscal hardware, full offline selling or operational
Backup/DR. For setup details, see [Browser tests](tests/e2e/README.md).
