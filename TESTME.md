# Test CRM layout and Service reports

## Start

1. Stop the current development process with `Ctrl+C`.
2. Run `npm run dev` so migration `0045` is applied.
3. Sign in to the ERP/CRM app as `manager@vista.local` with your existing
   development password.

## 1. Check the CRM ticket layout

1. From the sidebar choose **Customers & CRM**.
2. Select **Tickets & SLA**.
3. Confirm the six CRM tabs sit inside one white, rounded card.
4. Select **New ticket**, then scroll to the bottom of the panel.

Expected: the **Create ticket** and **Back** bar stays aligned to the full panel
width with no gap below it. The form remains readable while the panel scrolls.
Select **Back** without saving.

## 2. Review Service performance

1. From the sidebar choose **Service**.
2. Select **Reports** from the Service tabs.
3. Enter:
   - From: `2026-08-01`
   - To: `2026-08-31`
4. Select **Apply**.

Expected: request totals, status progress, Service types, recorded time, value,
and the technician table load without a validation error. The development data
includes completed Service work for this period.

## 3. Export the Service request register

1. On **Service reports**, select **Export report**.
2. Choose:
   - Report: **Service request register**
   - File type: **CSV**
   - From: `2026-08-01`
   - To: `2026-08-31`
3. Select **Prepare export**.
4. In **Recent exports**, select **Download** when the file shows **Ready**. The
   panel updates automatically; **Refresh** is available if needed.

Expected: a CSV file downloads and contains Service request rows. The panel can
be closed with **Close**, **Back**, or the `Esc` key, and there is no empty gap
under its action bar.
