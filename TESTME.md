# Test a collected POS return

Run locally with `npm run dev`. Use the demo accounts and local fiscal simulator.
This does not test DATECS hardware or send an actual repayment.

## One-time permission setup

Recording a repayment needs Finance Approve. If `finance@vista.local` cannot
record it, sign in as `local.admin@vista.local`:

1. Open **Security → Roles → Add role**. Name it `Finance Return Approver`, code
   `finance-return-approver`, and grant **Finance: View** and **Finance: Approve**.
2. Open **Security → Employees**, select **Manage** for `finance@vista.local`,
   assign the new role without removing its existing role, then save.
3. Sign in again as `finance@vista.local`.

## Create, return and reconcile the sale

1. Open Vista POS at `http://localhost:5174` and sign in as
   `pos.operator@vista.local`.
2. Choose **Shifts**. Enter opening cash `100`, then **Open cashier shift**.
3. Choose **Sell**. Search `DEV-ADAPTER-12V` and add one **Demo 12 V Power
   Adapter**.
4. In **Current sale**, choose **Add customer**. Search `Alfa`, select
   **Alfa Market Demo Ltd.** and **Alfa Market · Central Store**, then **Use
   customer**.
5. Choose **Advance / account**. Set **Use from advance** to `0` if shown. Choose
   **On account**, then **Complete sale**. Select **Prepare invoice** and note
   the sale number.
6. In Vista Operations at `http://localhost:5173`, sign in as
   `finance@vista.local`. Open **Finance → Financial documents**, preview the new
   draft, confirm the review checkbox and **Issue document**.
7. Open **Finance → Customer accounts**. Preview Alfa Market, find that sale and
   choose **Collect payment**. Enter `10`, today's date, **Bank transfer**, and
   reference `DEMO-POS-COLLECTION-01`. Confirm and **Record payment**.
8. In Vista POS, choose **Returns**. Find that sale, select **Start return**,
   select the adapter, keep the full quantity, and complete the return.
9. In Operations, return to **Finance → Customer accounts → Preview** for Alfa.
   Find the return. Confirm it shows the unpaid amount released and the collected
   amount still owed back. Choose **Prepare credit note**, review it, then
   **Issue document**.
10. Back on the customer account, choose **Record repayment**. Enter `10`,
    today's date, **Bank transfer**, reference `DEMO-POS-REPAY-01`; confirm the
    customer has received it, then record it.
11. Confirm the repayment appears once in the return history and the amount still
    owed is `0`. Reopen the invoice and confirm its original total is unchanged.
12. In POS, choose **Shifts**. Count cash as `100` and **Close cashier shift**.
    The recorded bank repayment must not change the POS drawer.

If a different collection amount is used, repay that exact amount instead of
`10`. For a return with no issued invoice, a credit note is not required. Switch
to **BG** and repeat the account preview at phone width to check the translation
and panel layout.
