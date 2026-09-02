# Test the first operational POS flow

Start Vista with `npm run dev`. Open the **Vista POS** app at
`http://localhost:5174/` and sign in as `pos.operator@vista.local` using the
password in `DEV_FIXTURES_PASSWORD`.

## 1. Open the counter

1. Choose **Shifts** in the left menu.
2. Keep **Demo POS terminal** selected.
3. Enter `100.00` for **Opening cash** and choose **Open cashier shift**.

Expected: **New sale** opens and shows live products and stock from the Demo
Central Warehouse.

## 2. Complete a cash sale

1. Choose **Demo 12 V Power Adapter**.
2. Enter `100.00` under **Cash received**.
3. Choose **Pay cash**.

Expected: the sale completes for `60.00 BGN`, the change is `40.00 BGN`, and a
clearly labelled development receipt opens. Choose **Start next sale**.

## 3. Sell a serialised device

1. Choose **Demo Fiscal Register X1**.
2. In the basket, choose any available serial number.
3. Choose **Add customer**, search for `Alfa Market`, and select
   **Alfa Market Demo Ltd.**
4. Select **Alfa Market — Central Store**, then choose **Use customer**.
5. Enter `800.00` under **Cash received** and choose **Pay cash**.

Expected: the sale completes for `720.00 BGN`, the chosen serial disappears from
available stock, and the receipt shows `80.00 BGN` change.

## 4. Review and close

1. Choose **Sale history**. Confirm both sales are listed.
2. Choose **Shifts**. Keep the prefilled expected amount under **Counted cash**
   and choose **Close cashier shift**.

Expected: the shift closes and its drawer count is recorded.

## 5. Confirm the customer record

1. Open the **ERP/CRM** app at `http://localhost:5173/` and sign in as
   `manager@vista.local`.
2. From the sidebar choose **Customers & CRM**, then **Partner registry**.
3. Open **Alfa Market Demo Ltd.** and choose **Customer overview**.

Expected: **Purchase history** includes the POS sale, and **Locations &
equipment** includes the fiscal register and serial number sold in step 3.

The receipt is a development simulator. Certified fiscal-device behavior is not
part of this test and will not be claimed until the client approves and supplies
the target hardware.
