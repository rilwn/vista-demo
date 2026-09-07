# Test saved reports and the Overview

Run `npm run dev` from the project folder (restart it if already running).
This applies the new migration. Open **Vista Operations** at
[localhost:5173](http://localhost:5173/) and sign in as **manager@vista.local**
using your existing `DEV_FIXTURES_PASSWORD`. No new sale or payment is needed.

## 1. Save and reuse a report

1. From the sidebar choose **ERP → Finance**, then **Finance reports**.
2. Select **Export report**. Choose **Report: Supplier turnover**.
3. Enter **From: 2026-01-01**, **To: 2026-12-31**.
4. Under **Fields to include**, keep only **Partner** and **Gross BGN** checked.
5. Choose **Excel**. In **Save these options**, enter `2026 supplier totals`.
   Select **Save as new report**.
6. Select **Close**, reopen **Export report**, then choose **2026 supplier totals**
   from **My saved reports**.

Expected: your report, dates, two selected fields and Excel format are restored.
The panel scrolls while its header and full-width bottom buttons stay visible.

## 2. Download all three formats

1. Select **Prepare export**. In **Recent exports**, wait for **Ready**, then
   select **Download**. If needed, use **Refresh**.
2. Open the Excel file: its data table must contain only **Partner** and
   **Gross BGN**. Your existing supplier invoices determine the rows and totals;
   no rows is valid if none fall within this period.
3. Select **CSV → Prepare export → Download** when Ready.
4. Repeat with **PDF**. The same two fields and values should appear in all
   three files if no source records changed between exports.
5. Uncheck both remaining fields: **Prepare export** must be disabled.
   Select **Close** without saving another copy.

## 3. Review the Overview

1. Choose **Overview** in the sidebar.
2. Set **Revenue from: 2026-01-01**, **Revenue to: 2026-12-31**, and
   **Warranties ending within: 30 days**. Select **Apply**.
3. Check the four cards: **Recorded revenue**, **Active Service requests**,
   **Warranties ending soon**, and **Overdue receivables**.
4. Use **Review Finance reports**, then the sidebar **Overview** to return.

Expected: the link opens Finance reports, not a 404. Revenue uses your chosen
period; Service, warranty and overdue figures describe the current date.
**Recorded revenue includes prepared invoices and notes; it is not posted
accounting revenue.** Zero values are valid.

Optional role check: sign out through the top-right account menu and sign in as
**finance@vista.local**. The Overview must not show global Service or warranty
counts, and the manager’s saved reports must not appear in this account.
