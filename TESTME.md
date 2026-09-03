# Test POS offers, discounts, and rewards

Run `npm run dev`. It now applies migrations and prepares local accounts
automatically. Use the password already set in `DEV_FIXTURES_PASSWORD`.

## 1. Review the counter offers

1. Open ERP/CRM and sign in as `sales@vista.local`.
2. From the sidebar choose **ERP → Sales**.
3. Open **Prices & promotions**, then choose **POS offers**.

Expected: **Two adapters save 10%** and **Print care bundle** appear as running
offers. **Add POS offer** opens a fitted, scrollable panel with dates, priority,
discount, and qualifying products. Close it with **Back** without saving.

## 2. Apply an offer and protected discount

1. Open Vista POS and sign in as `pos.operator@vista.local`.
2. Choose **Shifts**. If the counter is closed, choose **Open cashier shift**,
   enter `100.00`, and open it. Return to **Sell**.
3. Add **Demo 12 V Power Adapter**, then use its **+** button so the quantity is
   `2`.

Expected: the basket shows **Two adapters save 10%**, **Offers −10.00 BGN**, and
**Total due 108.00 BGN**.

4. Choose **Add customer**, search `Alfa Market`, select **Alfa Market Demo
   Ltd.**, keep **Central Store**, and choose **Use customer**.
5. Choose **Manual discount**. Keep **Percentage** and `10`, use reason
   `Customer care discount`, approver `manager@vista.local`, and the same local
   fixture password. Leave the authentication code empty and choose **Approve
   discount**.

Expected: the basket says **Manual discount approved**, names **Vista Demo
Manager**, and shows **Manual discount −9.00 BGN**. Do not change the basket
after approval; a change intentionally clears it.

## 3. Redeem, earn, and verify points

1. Confirm the selected customer starts with `300 reward points`.
2. Enter `100` in **Points to use**.

Expected: **Rewards −1.00 BGN** and **Total due 96.00 BGN**.

3. Keep **Cash**, enter `100.00` in **Cash received**, and choose **Complete
   sale**.

Expected: the receipt shows `96.00 BGN`, change `4.00 BGN`, `100` points used,
and `96` points earned.

4. Close the receipt, add one adapter, and choose the customer's reward row.

Expected: the balance is `296 points`. The history keeps separate opening,
redeemed, and earned entries with a running balance; no earlier entry is changed.
