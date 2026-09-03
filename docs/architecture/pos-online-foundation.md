# Online POS foundation

The first operational POS slice uses the ERP-owned catalog, warehouse stock,
pricing, customers, locations, registers, operators, serials, and batches. The
POS does not keep a competing master-data store.

## Completed flow

1. An assigned operator opens one register shift with a counted cash balance.
2. The terminal searches products by name, product code, or barcode and returns
   current available stock and applicable price-list or promotion pricing.
3. Checkout validates quantity, VAT, cash, card, or split tender,
   customer/location, and the required serial or batch selection.
4. One database transaction records the sale, lines, payments, inventory
   movements, serial ownership, customer equipment and warranty data, audit
   event, and integration outbox event.
5. A stable client transaction ID and idempotency key make a repeated request
   return the original sale rather than post it twice.
6. A linked partial or full return validates the unreturned line quantities and
   serials, follows the original payment methods, and either restores saleable
   stock or transfers a serialised device to the Service warehouse. The fiscal
   reversal, refunds, stock/equipment state, audit event, and outbox event commit
   together and are safe to replay.
7. The shift closes with expected cash after cash refunds, counted cash, and the
   resulting difference.
8. Each register has an operator-managed quick-access set of up to 12 active
   ERP products. The cards always resolve current customer pricing and warehouse
   availability rather than copying catalogue data into POS.
9. The reporting workspace provides period and location filters, shift and
   cashier performance, product and category sales, payment-method totals,
   location totals, and cross-location comparison. X reports show an open
   shift as of the request time; Z reports use the completed shift totals.
10. All nine controlled POS reports can be prepared asynchronously as CSV,
    Excel, or PDF. Export jobs and downloads are private to the requesting
    account, retryable, and retained with their exact filters.
11. Sales maintains dated quantity and bundle offers. The server applies the
    highest-priority eligible offer first and does not stack automatic offers on
    the same product. Qualifying sets can repeat within one basket.
12. A manual percentage or fixed-BGN discount requires a different active
    employee with `pos:approve`. The approval is bound to the exact cashier,
    shift, customer, basket, and discount, expires after five minutes, and is
    consumed by one sale.
13. Customer rewards use a canonical customer loyalty account and an append-only
    points ledger. Completed sales add earned points and optional redemption
    entries. Partial and full returns add proportional reversal/restoration
    entries; posted activity is never edited or deleted.

## Counter interface

The terminal uses a fixed, full-height counter shell. The lean top bar, primary
navigation, and connection strip stay visible while product results, baskets,
returns, and report tables scroll within their own work areas. At tablet and
phone widths the navigation becomes a horizontal touch strip and the selling
workspace stacks without creating an uncontrolled document scrollbar.

Short action feedback appears as an accessible toast without moving the basket
or controls. Completed sales and errors have distinct, restrained sound cues.
Each employee can switch **Sale sounds** on or off from the account menu; the
choice is stored only for that employee in that browser. Sound failure never
blocks or changes a transaction.

Money is calculated with fixed-precision integer arithmetic in the service.
Stock rows and numbering sequences are locked while posting. A serial number
cannot be sold unless it is available in the shift warehouse.

Commercial pricing is recalculated inside checkout after stock and shift locks
are acquired; browser totals are previews only. Automatic offers reduce the
qualifying net line value, an approved manual discount follows, and reward
redemption is applied last. The development loyalty program earns one point per
completed gross BGN and values one point as a BGN 0.01 pre-VAT discount. These
rates are stored program data and must be replaced with the POS-003-approved
production policy before rollout.

## Fiscal boundary

Local development uses explicit receipt, reversal, and card-payment simulators
so the complete business transaction can be tested without physical devices.
The simulators are rejected when the API runs in production. Certified Bulgarian
Ordinance H-18 issuance and reversal, PIN-pad handling, receipt printing, and
hardware recovery require the approved POS-001 devices and protocols before
implementation or acceptance.

Development X and Z reports include simulated fiscal totals. They are operational
cashier reports for testing and must not be represented as certified fiscal-device
reports until the approved H-18 adapter and target hardware pass acceptance.
