# Test Logistics

## Start

1. Stop the development server if it is running.
2. Run `npm run db:migrate`.
3. Run `npm run db:fixtures:dev` once so the matching demo shipment, location,
   equipment, and permissions are present.
4. Run `npm run dev`, open `http://localhost:5173`, and sign in as
   `manager@vista.local` with your `DEV_FIXTURES_PASSWORD`.

## Delivery and route

1. From the sidebar choose **ERP → Logistics → Deliveries**.
2. Select **Plan delivery** and use:
   - Shipment: `DEV-SH-0001 · Alfa Market Demo Ltd.`
   - Delivery location: `Alfa Market — Central Store · Vratsa`
   - Keep the suggested window
   - Instructions: `Call Elena 15 minutes before arrival.`
3. Select **Plan delivery**, then use **Back** in its preview.
4. Open **Routes**, select **Plan route**, keep the suggested date and manager,
   select the new `DLV-...` customer delivery as the first stop, and save.

Expected: the route appears on its selected calendar date and retains the linked
delivery stop.

5. Return to **Deliveries**, open the new `DLV-...` row, and select **Dispatch**.
6. Select **Record delivery**. Enter recipient `Elena Petrova`, keep the shown
   time, add `One box received in good condition.`, and confirm.

Expected: the delivery is **Delivered**, its activity shows each step, and the
handover is **Accepted**. **Back** returns to the delivery board, while the route
keeps its historical stop snapshot.

## Return to Service

1. Open **ERP → Logistics → Returns** and select **Register return**.
2. Use:
   - Shipment: `DEV-SH-0001 · Alfa Market Demo Ltd.`
   - Customer location: `Alfa Market — Central Store · Vratsa`
   - Shipment item: `Demo 12 V Power Adapter`
   - Quantity: `1`
   - Destination warehouse: `Demo Service Warehouse`
   - Next action: **Send to Service**
   - Equipment: `Demo 12 V Power Adapter · DEMO-ADAPTER-ALFA-01`
   - Service type: **Out of warranty**
   - Transport: **Customer drop-off**
   - Reason: `Adapter does not power on after installation.`
3. Select **Register return**, then select **Receive return** in its preview.

Expected: the return becomes **Received**, shows its inventory movement, and
shows one linked `SRV-...` Service request. Reopening it never creates a second
stock movement or Service request.

## Provider boundary

Open **ERP → Logistics → Couriers**. Econt and Speedy must both show **Not
connected** and must not offer a booking action until their approved provider
configuration is supplied.
