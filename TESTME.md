# Test the report library and schedules

## Appearance checks

1. Open POS at http://localhost:5174. If signed in, sign out through the account
   menu. The sign-in button should be green, including when hovered.
2. Open Recovery at http://localhost:5175 and sign in with your existing backup
   account. The sidebar should be light. Choose **Policies** in the topbar area
   selector, then **Overview** in the sidebar. Both controls should stay in sync.
3. In Operations at http://localhost:5173, open **ERP → Finance** from the
   sidebar. The page title and icon should be compact, with readable description
   text. Narrow the window: headings should wrap without horizontal overflow.

## Report setup

Restart with `npm run dev` to apply the new migration. No manual seed command is needed.
Open ERP/CRM at http://localhost:5173 and sign in as **manager@vista.local** with
your existing development password.

## 1. Save and download a report

1. Sidebar: **ERP → Warehouse → Reports**. Select **Stock and valuation**.
2. Leave the search empty and select **Apply**. Open **Customize view**.
3. Keep the selected fields. Enter **Daily stock review** in **Report name**,
   choose **CSV** in **File type**, then **Save as new report**.
4. Sidebar: **Reports → Report library**. Find **Daily stock review** under
   **My saved views**, then **Review saved view → Prepare export · CSV**.
5. When it says **Ready**, select **Download**. The file contains the selected
   stock columns. An empty warehouse may produce headings without data rows.

## 2. Schedule it

1. In the same saved-view panel, select **Schedule this view**.
2. Name: **Daily stock download**. Repeat: **Daily**. Reporting period:
   **Current records**. Keep the suggested **First run**, which is about two
   minutes ahead in the timezone shown below the field. Select **Create schedule**.
3. Select **Scheduled exports**, then **Run history** beside your schedule.
   After the chosen time, one run appears and changes from **Queued/Preparing**
   to **Ready**. Select **Download**. The history refreshes automatically.
4. Select **Back**, then **Pause** beside the schedule. It should say **Paused**.
   Leave it paused after testing to avoid unwanted daily files.

The notification bell also shows **Your scheduled report is ready** after
processing. Files stay in your account; no email is sent. **Resume** catches up
occurrences missed while paused. Current-stock reports use stock at execution
time, not historical stock.

## 3. Save your dashboard layout

1. Sidebar: **Customers & CRM → Analytics**. Open **Customize cards**.
2. Uncheck **Average transaction**, then **Save layout**. That card disappears.
3. Reload the page. It stays hidden. Open **Customize cards → Show all → Save layout**
   to restore it.
4. The same control is available in **ERP → Service → Reports**, **ERP → Finance →
   Finance reports → Aging & balances**, and **Vista POS → Reports** using your
   POS operator account. Preferences affect only the signed-in account.
