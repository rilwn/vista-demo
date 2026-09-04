# Test a POS invoice and warranty card

Start the project with `npm run dev`. It applies migrations and prepares the
enabled development fixtures automatically. Use the password stored in
`DEV_FIXTURES_PASSWORD`.

## 1. Complete a customer device sale

1. Open **Vista POS** and sign in as `pos.operator@vista.local`.
2. Choose **Shifts**. If there is no open shift, select **Open shift**, enter
   `100.00` for **Opening cash**, and open it.
3. Choose **Sell**.
4. Select **Customer** → search `Alfa Market` → choose **Alfa Market Demo Ltd.**
   → keep **Central Store** → select **Use customer**.
5. Add **Demo Electronic Scale S1** and choose one of its available serial
   numbers. If none is available, use **Demo Fuel Module M1**.
6. Choose **Bank card**, then select **Complete sale**.

Expected: the receipt opens with its sale number, fiscal receipt number, payment,
and one warranty card showing the device and serial number.

## 2. Download the card and prepare the invoice

1. On the receipt, select **Download PDF** under **Warranty cards**.
2. Open the downloaded file.

Expected: it is a readable one-page warranty card with Vista Service, the
customer, device, serial number, sale date, coverage dates, sale number, and
receipt number.

3. Return to the receipt and select **Prepare invoice**.

Expected: the receipt shows one Finance document number and confirms that the
draft is ready for review.

4. Close the receipt, choose **Sale history**, and open the same row with **View
   receipt**.

Expected: the same Finance number remains and the prepare action is no longer
shown. A second invoice is not created.

## 3. Review the linked Finance draft

1. Sign out of Vista POS.
2. Open **ERP/CRM** and sign in as `finance@vista.local`.
3. From the sidebar choose **ERP → Finance**.
4. Under **Choose an area**, open **Financial documents**.
5. Find the newest invoice for **Alfa Market Demo Ltd.** and select **Preview**.

Expected: the preview shows **POS sale** and **Fiscal receipt** references. Its
product, quantity, VAT, and total match the completed POS receipt exactly.

This workflow prepares a Finance draft. Official invoice issuance and certified
fiscal-device printing remain disabled until the approved legal and hardware
rules are available.
