# Test warranty claims and inspections

## Start

1. Stop development once with `Ctrl+C`, then run `npm run dev`.
2. Open the ERP/CRM app and sign in as `manager@vista.local` with your existing
   fixture password.
3. From the sidebar choose **ERP → Service → Warranty & inspections**.

Expected: the page shows warranty coverage, warranty claims, and required
inspections.

## 1. Complete a warranty claim

1. Select **New warranty claim**.
2. Use these values:
   - Equipment: **Demo Receipt Printer · DEMO-PRINTER-ALFA-01 · Alfa Market Demo Ltd.**
   - Description: `Printer stops feeding paper after several receipts.`
3. Select **Create claim**.
4. In the claim panel, select **Start review**.
5. Enter decision note `Warranty repair approved after technical review.` and
   select **Approve**.
6. Select **Close claim**, then use **Back**.

Expected: the claim is **Closed** and its history shows **Received**, **Under
review**, **Approved**, and **Closed** once each.

Optional evidence check: before closing the claim, choose a PDF, JPEG, PNG, or
WebP file smaller than 10 MB and select **Upload file**. The file should remain
available from the claim panel.

## 2. Record a completed inspection

This records an inspection that has already taken place. It does not schedule a
new technician visit.

1. Stay on **ERP → Service → Warranty & inspections**.
2. Find the **Inspection schedule** section.
3. Select the card that shows:
   - Type: **Technical**
   - Device: **Demo Receipt Printer**
   - Serial number: **DEMO-PRINTER-ALFA-01**
4. In the right panel, select **Record completed inspection** under **After the
   inspection**.
5. Enter:
   - Completed on: `2026-08-26`
   - Outcome: **Passed**
   - Findings: `Printer passed the scheduled technical inspection.`
6. Select **Save inspection result**.

Expected: the inspection shows the saved result, the last completion date is
`26 Aug 2026`, the result appears under **Completed inspections**, and the next
due date moves to `26 Aug 2027`. Select **Back** to return to the care page.
