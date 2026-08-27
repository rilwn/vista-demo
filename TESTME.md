# Test one complete serial lifecycle

Use `manager@vista.local`. Restart `npm run dev` first so migration `0046` is
applied. Use serial `TRACE-FR-0827-01`; if you already used it, change the last
number.

## 1. Receive the device from its supplier

1. From the sidebar choose **ERP → Procurement → Purchase orders**.
2. Select **New purchase order** and enter:
   - Supplier: **TechSupply Demo Ltd.**
   - Warehouse: **Demo Central Warehouse**
   - Currency: `BGN`
   - Product: **DEV-FISCAL-X1 · Demo Fiscal Register X1**
   - Quantity: `1`
   - Unit price: `750`
   - Expected delivery: `2026-09-01`
3. Save the order. On its card select **Receive delivery** and enter:
   - Delivery reference: `TRACE-GR-0827-01`
   - Quantity: `1`
   - Unit cost: `750`
   - Serial number: `TRACE-FR-0827-01`
4. Select **Receive delivery**.

Expected: the order is received and a goods receipt appears under **Goods
receipts**.

## 2. Sell and hand over the same device

1. Choose **ERP → Sales → Quotations**, then **New quotation**.
2. Enter:
   - Customer: **Alfa Market Demo Ltd.**
   - Warehouse: **Demo Central Warehouse**
   - Valid until: `2026-09-10`
   - Currency: `BGN`
   - Product: **Demo Fiscal Register X1**
   - Quantity: `1`; unit price: `900`; both discounts: `0`; VAT: **20% VAT**
3. Create the quotation and select **Preview**.
4. Select serial `TRACE-FR-0827-01`, then select **Confirm order and reserve
   stock** and **Complete shipment**.
5. In the handover section choose **Alfa Market — Central Store**, enter customer
   representative `Elena Ivanova`, then select **Record customer acceptance**.

Expected: the handover shows the customer location and the serial is registered
there automatically.

## 3. Return it for repair

1. Choose **ERP → Logistics → Returns**, then **Register return**.
2. Choose the shipment just created and enter:
   - Customer location: **Alfa Market — Central Store**
   - Returned serial: `TRACE-FR-0827-01`
   - Destination: **Demo Service Warehouse**
   - Next action: **Send to Service**
   - Customer equipment: the option showing `TRACE-FR-0827-01`
   - Service type: **Out of warranty**
   - Arrival: **Customer drop-off**
   - Reason: `Device does not print after power-up.`
3. Register the return, open its preview, and select **Receive return**. Note the
   Service request number shown.

Expected: the stock return is posted once and one linked Service request is
created.

## 4. Complete the repair and inspect the history

1. Choose **ERP → Service → Service requests**, open the request number noted
   above, and select **Dispatch request**.
2. Choose **Vista Demo Service Technician**. Use `2026-08-28 10:00` to `11:00`,
   then select **Assign visit**.
3. Choose **Service → Work orders**, open the new work order, select **Start
   work**, reopen it, and select **Complete work**.
4. In **Complete work** enter:
   - Completion note: `Checked power and print functions; device passed the final test.`
   - Minutes: `45`
   - Labour: `45`
   - Transport: `10`
   - Customer representative: `Elena Ivanova`
   - Draw a short signature, then select **Complete work**.
5. Choose **ERP → Warehouse → Reservations & serial trace**, enter
   `TRACE-FR-0827-01`, and select **Trace serial**.

Expected: one ordered timeline shows supplier receipt, sale, customer handover,
return registration and receipt, Service request, scheduled technician, repair
start, and repair completion. The registered customer remains Alfa Market at its
Central Store; current custody is the Demo Service Warehouse after the repair.
