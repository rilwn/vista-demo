# Test initial administrator access and account recovery

This is the completed first-administrator and controlled account-recovery flow.
It uses the private development database only. Do not run the provisioning step
if an administrator already exists.

The administrator must be provisioned successfully before attempting the
administrator sign-in in section 2. The normal development fixture bootstrap
does not create an administrative account because administrative access must
have a separately enrolled second factor.

## 1. Provision the first administrator once

1. Ensure your private `.env` has `NODE_ENV=development`,
   `DEV_FIXTURES_ENABLED=true`, and your private `DEV_FIXTURES_PASSWORD`.
2. Add these temporary settings to the same `.env`. For
   `INITIAL_ADMIN_PASSWORD`, enter the exact private password you already chose
   for `DEV_FIXTURES_PASSWORD` (it must meet the password policy).

   ```dotenv
   INITIAL_ADMIN_PROVISIONING_ENABLED=true
   INITIAL_ADMIN_EMAIL=local.admin@vista.local
   INITIAL_ADMIN_DISPLAY_NAME=Local Vista Administrator
   INITIAL_ADMIN_EMPLOYEE_NUMBER=LOCAL-ADMIN-001
   INITIAL_ADMIN_PASSWORD=<your-private-fixture-password>
   ```

3. Run `npm run iam:provision-initial-admin`.
4. Confirm that the terminal says
   `Initial administrator provisioned for local.admin@vista.local.` If it does
   not, stop here and use the reported error to correct the setup.
5. Copy the one-time setup key printed in the terminal into a trusted
   time-based authenticator app. Do not store that key in a ticket, chat, or
   source file.
6. Remove the five `INITIAL_ADMIN_*` settings from `.env` (or at minimum set
   `INITIAL_ADMIN_PROVISIONING_ENABLED=false`), then start the stack with
   `npm run dev`.

Expected: the command succeeds once only. Re-running it is refused because an
administrator now exists.

## 2. Sign in as the administrator

1. Open `http://localhost:5173`.
2. Enter `local.admin@vista.local` and the password you used above.
3. Enter the current six-digit code from the authenticator app.

Expected: the Workspace overview opens. **Administration → Security** is
available.

## 3. Recover a standard employee account

1. In the sidebar, choose **Administration → Security**.
2. In **Employees**, search for **Vista Demo Manager** and select **Manage**.
3. In **Account recovery**, select **Issue recovery handoff**.
4. Keep or replace the note with `Identity verified in person.` and select
   **Issue recovery code**.
5. Record the code shown in the panel. Close the panel.
6. Open a private browser window at `http://localhost:5173` and select
   **Use a recovery code** on the sign-in screen.
7. Enter:
   - Work email: `manager@vista.local`
   - Recovery code: the code from step 5
   - New password: a new private policy-compliant password
   - Confirm new password: the same new password
8. Select **Reset password**, then **Back to sign in**.
9. Sign in as `manager@vista.local` with the new password.

Expected: recovery reports success, the code cannot be reused, and the manager
can sign in with the replacement password. The Security activity log records
the handoff and recovery without showing the code or password.

## Not part of this test

- Email or SMS delivery of recovery messages; approved provider adapters are
  still pending.
- Recovering the administrator itself in the browser, because that deliberately
  closes the current administrator session and requires a fresh authenticator
  setup. This protected branch is covered by the automated integration suite.
