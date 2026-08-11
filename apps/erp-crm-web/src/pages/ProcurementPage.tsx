import { Button, InlineAlert } from '@vista/ui';
import type {
  CreatePurchaseOrderRequest,
  ProcurementReferenceData,
  PurchaseOrder,
  PurchaseOrderStatus,
  ReceivePurchaseOrderRequest,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createPurchaseOrder,
  getProcurementReferenceData,
  listPurchaseOrders,
  receivePurchaseOrder,
} from '../api/procurement';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { messages } from '../messages';
import { ProcurementTabs } from './SupplierProcurementPage';

export type ProcurementView = 'goods-receipts' | 'purchase-orders';

export function ProcurementPage({ view }: { view: ProcurementView }) {
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const data = useProcurementData(token, status || undefined);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canCreate = hasPermission('erp.procurement', 'create');

  if (data.loading) return <ProcurementLoading />;
  if (data.error)
    return (
      <ProcurementState title={messages.procurement.loadError}>
        <Button onClick={data.reload} variant="secondary">
          {messages.procurement.retry}
        </Button>
      </ProcurementState>
    );

  const receipts = data.orders.flatMap((order) =>
    order.receipts.map((receipt) => ({ order, receipt })),
  );

  return (
    <div className="page-stack procurement-page">
      <header className="page-header procurement-header">
        <div>
          <p className="page-eyebrow">{messages.procurement.eyebrow}</p>
          <h1>
            {view === 'purchase-orders'
              ? messages.procurement.orders
              : messages.procurement.receipts}
          </h1>
          <p>
            {view === 'purchase-orders'
              ? 'Plan purchases, follow delivery progress, and receive stock without duplicate entry.'
              : 'Review supplier deliveries and the warehouse movements created from them.'}
          </p>
        </div>
        {view === 'purchase-orders' && canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <Icon name="plus" size={17} />
            {messages.procurement.newOrder}
          </Button>
        ) : null}
      </header>

      <ProcurementTabs view={view} />

      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}

      {view === 'purchase-orders' ? (
        <>
          <section className="procurement-toolbar" aria-label="Purchase order filters">
            <label>
              <span>{messages.procurement.status}</span>
              <select
                onChange={(event) => setStatus(event.target.value as PurchaseOrderStatus | '')}
                value={status}
              >
                <option value="">{messages.procurement.allStatuses}</option>
                <option value="open">{messages.procurement.open}</option>
                <option value="partially_received">{messages.procurement.partiallyReceived}</option>
                <option value="received">{messages.procurement.received}</option>
              </select>
            </label>
            <span>{data.total} orders</span>
          </section>
          {data.orders.length ? (
            <section className="procurement-order-list" aria-label="Purchase orders">
              {data.orders.map((order) => (
                <PurchaseOrderCard
                  canReceive={canCreate}
                  key={order.id}
                  onReceive={() => setReceiving(order)}
                  order={order}
                />
              ))}
            </section>
          ) : (
            <ProcurementState title={messages.procurement.emptyOrders}>
              <p>{messages.procurement.emptyOrdersHint}</p>
            </ProcurementState>
          )}
        </>
      ) : receipts.length ? (
        <section className="procurement-receipt-list" aria-label="Goods receipts">
          {receipts.map(({ order, receipt }) => (
            <article className="procurement-receipt-card" key={receipt.id}>
              <div className="procurement-receipt-mark">
                <Icon name="warehouse" size={18} />
              </div>
              <div>
                <strong>{order.supplierName}</strong>
                <span>
                  {receipt.supplierDeliveryReference ?? shortIdentity(receipt.id)} ·{' '}
                  {formatDateTime(receipt.receivedAt)}
                </span>
              </div>
              <div>
                <strong>{receipt.lines.length}</strong>
                <span>{receipt.lines.length === 1 ? 'product line' : 'product lines'}</span>
              </div>
              <div>
                <strong>{order.warehouseName}</strong>
                <span>Receiving warehouse</span>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <ProcurementState title={messages.procurement.emptyReceipts}>
          <p>{messages.procurement.emptyReceiptsHint}</p>
        </ProcurementState>
      )}

      {creating ? (
        <PurchaseOrderDrawer
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            setNotice(messages.procurement.createSuccess);
            data.reload();
          }}
          referenceData={data.referenceData}
          token={token}
        />
      ) : null}
      {receiving ? (
        <GoodsReceiptDrawer
          onClose={() => setReceiving(null)}
          onReceived={() => {
            setReceiving(null);
            setNotice(messages.procurement.receiveSuccess);
            data.reload();
          }}
          order={receiving}
          referenceData={data.referenceData}
          token={token}
        />
      ) : null}
    </div>
  );
}

function PurchaseOrderCard({
  canReceive,
  onReceive,
  order,
}: {
  canReceive: boolean;
  onReceive: () => void;
  order: PurchaseOrder;
}) {
  const progress = order.lines.reduce(
    (total, line) => ({
      delivered: total.delivered + Number(line.deliveredQuantity),
      ordered: total.ordered + Number(line.orderedQuantity),
    }),
    { delivered: 0, ordered: 0 },
  );
  return (
    <article className="procurement-order-card">
      <header>
        <div>
          <span className="procurement-order-id">{shortIdentity(order.id)}</span>
          <h2>{order.supplierName}</h2>
          <p>{order.warehouseName}</p>
        </div>
        <span className={`procurement-status is-${order.status}`}>{statusLabel(order.status)}</span>
      </header>
      <div className="procurement-order-metrics">
        <div>
          <span>{messages.procurement.total}</span>
          <strong>{formatOrderTotal(order)}</strong>
        </div>
        <div>
          <span>{messages.procurement.delivered}</span>
          <strong>
            {formatQuantity(progress.delivered)} / {formatQuantity(progress.ordered)}
          </strong>
        </div>
        <div>
          <span>{messages.procurement.line}</span>
          <strong>{order.lines.length}</strong>
        </div>
      </div>
      <div className="procurement-line-table" role="table" aria-label="Order lines">
        <div className="procurement-line-head" role="row">
          <span role="columnheader">{messages.procurement.product}</span>
          <span role="columnheader">{messages.procurement.expectedDate}</span>
          <span role="columnheader">{messages.procurement.delivered}</span>
          <span role="columnheader">{messages.procurement.invoiced}</span>
        </div>
        {order.lines.map((line) => (
          <div className="procurement-line-row" key={line.id} role="row">
            <span role="cell">
              <strong>{line.productName}</strong>
              <small>
                {formatMoney(line.unitPrice, order.currencyCode)} × {line.orderedQuantity}
              </small>
            </span>
            <span role="cell">{formatDate(line.expectedDeliveryDate)}</span>
            <span role="cell">
              {line.deliveredQuantity} / {line.orderedQuantity}
            </span>
            <span role="cell">{line.invoicedQuantity}</span>
          </div>
        ))}
      </div>
      {canReceive && order.status !== 'received' ? (
        <footer>
          <Button onClick={onReceive} variant="secondary">
            {messages.procurement.receive}
          </Button>
        </footer>
      ) : null}
    </article>
  );
}

interface OrderLineDraft {
  expectedDeliveryDate: string;
  key: string;
  productId: string;
  quantity: string;
  unitPrice: string;
}

function PurchaseOrderDrawer({
  onClose,
  onCreated,
  referenceData,
  token,
}: {
  onClose: () => void;
  onCreated: () => void;
  referenceData: ProcurementReferenceData;
  token: string;
}) {
  const [supplierPartnerId, setSupplierPartnerId] = useState(referenceData.suppliers[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(referenceData.warehouses[0]?.id ?? '');
  const [currencyCode, setCurrencyCode] = useState('BGN');
  const [lines, setLines] = useState<OrderLineDraft[]>([emptyOrderLine(referenceData)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierPartnerId || !warehouseId || lines.some((line) => !completeOrderLine(line))) {
      setError(messages.procurement.createError);
      return;
    }
    setBusy(true);
    setError(null);
    const input: CreatePurchaseOrderRequest = {
      currencyCode,
      lines: lines.map(({ expectedDeliveryDate, productId, quantity, unitPrice }) => ({
        expectedDeliveryDate,
        productId,
        quantity,
        unitPrice,
      })),
      supplierPartnerId,
      warehouseId,
    };
    try {
      await createPurchaseOrder(token, crypto.randomUUID(), input);
      onCreated();
    } catch (caught) {
      setError(procurementError(caught, messages.procurement.createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProcurementDrawer
      busy={busy}
      onClose={onClose}
      subtitle={messages.procurement.orderSubtitle}
      title={messages.procurement.orderTitle}
    >
      <form
        className="procurement-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!referenceData.suppliers.length ||
        !referenceData.warehouses.length ||
        !referenceData.products.length ? (
          <InlineAlert tone="warning">
            Add at least one supplier, product, and warehouse before creating an order.
          </InlineAlert>
        ) : null}
        <div className="procurement-form-grid">
          <SelectField
            label={messages.procurement.supplier}
            onChange={setSupplierPartnerId}
            options={referenceData.suppliers.map((supplier) => [supplier.id, supplier.name])}
            value={supplierPartnerId}
          />
          <SelectField
            label={messages.procurement.warehouse}
            onChange={setWarehouseId}
            options={referenceData.warehouses.map((warehouse) => [warehouse.id, warehouse.name])}
            value={warehouseId}
          />
          <label>
            <span>{messages.procurement.currency}</span>
            <input
              maxLength={3}
              onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
              required
              value={currencyCode}
            />
          </label>
        </div>

        <section className="procurement-lines-editor">
          <header>
            <div>
              <strong>Products</strong>
              <span>Prices use the order currency. Quantities support four decimal places.</span>
            </div>
            <Button
              onClick={() => setLines((current) => [...current, emptyOrderLine(referenceData)])}
              type="button"
              variant="quiet"
            >
              {messages.procurement.addLine}
            </Button>
          </header>
          {lines.map((line, index) => (
            <div className="procurement-order-line-editor" key={line.key}>
              <SelectField
                label={messages.procurement.product}
                onChange={(value) => updateOrderLine(setLines, line.key, { productId: value })}
                options={referenceData.products.map((product) => [
                  product.id,
                  `${product.productCode} · ${product.name}`,
                ])}
                value={line.productId}
              />
              <label>
                <span>{messages.procurement.quantity}</span>
                <input
                  inputMode="decimal"
                  onChange={(event) =>
                    updateOrderLine(setLines, line.key, { quantity: event.target.value })
                  }
                  pattern="\d+(\.\d{1,4})?"
                  required
                  value={line.quantity}
                />
              </label>
              <label>
                <span>{messages.procurement.unitPrice}</span>
                <input
                  inputMode="decimal"
                  onChange={(event) =>
                    updateOrderLine(setLines, line.key, { unitPrice: event.target.value })
                  }
                  pattern="\d+(\.\d{1,4})?"
                  required
                  value={line.unitPrice}
                />
              </label>
              <label>
                <span>{messages.procurement.expectedDate}</span>
                <input
                  onChange={(event) =>
                    updateOrderLine(setLines, line.key, {
                      expectedDeliveryDate: event.target.value,
                    })
                  }
                  required
                  type="date"
                  value={line.expectedDeliveryDate}
                />
              </label>
              {lines.length > 1 ? (
                <button
                  aria-label={`${messages.procurement.removeLine} ${index + 1}`}
                  className="procurement-remove-line"
                  onClick={() =>
                    setLines((current) => current.filter((item) => item.key !== line.key))
                  }
                  type="button"
                >
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </div>
          ))}
        </section>
        <div className="security-drawer-actions">
          <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
            {messages.procurement.close}
          </Button>
          <Button disabled={busy} type="submit">
            {busy ? messages.procurement.saving : messages.procurement.save}
          </Button>
        </div>
      </form>
    </ProcurementDrawer>
  );
}

interface ReceiptLineDraft {
  batchNumber: string;
  expiresAt: string;
  include: boolean;
  orderLineId: string;
  quantity: string;
  serialNumbers: string;
  unitCostBgn: string;
}

function GoodsReceiptDrawer({
  onClose,
  onReceived,
  order,
  referenceData,
  token,
}: {
  onClose: () => void;
  onReceived: () => void;
  order: PurchaseOrder;
  referenceData: ProcurementReferenceData;
  token: string;
}) {
  const dueLines = order.lines.filter(
    (line) => decimalUnits(line.deliveredQuantity) < decimalUnits(line.orderedQuantity),
  );
  const [lines, setLines] = useState<ReceiptLineDraft[]>(
    dueLines.map((line) => ({
      batchNumber: '',
      expiresAt: '',
      include: true,
      orderLineId: line.id,
      quantity: subtractDecimal(line.orderedQuantity, line.deliveredQuantity),
      serialNumbers: '',
      unitCostBgn: order.currencyCode === 'BGN' ? line.unitPrice : '',
    })),
  );
  const [supplierDeliveryReference, setSupplierDeliveryReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const included = lines.filter((line) => line.include);
    if (!included.length) {
      setError(messages.procurement.receiveError);
      return;
    }
    const input: ReceivePurchaseOrderRequest = {
      lines: included.map((line) => ({
        ...(line.batchNumber ? { batchNumber: line.batchNumber } : {}),
        ...(line.expiresAt ? { expiresAt: line.expiresAt } : {}),
        orderLineId: line.orderLineId,
        quantity: line.quantity,
        ...(line.serialNumbers.trim()
          ? { serialNumbers: splitSerialNumbers(line.serialNumbers) }
          : {}),
        ...(line.unitCostBgn ? { unitCostBgn: line.unitCostBgn } : {}),
      })),
      ...(supplierDeliveryReference.trim()
        ? { supplierDeliveryReference: supplierDeliveryReference.trim() }
        : {}),
    };
    setBusy(true);
    setError(null);
    try {
      await receivePurchaseOrder(token, order.id, crypto.randomUUID(), input);
      onReceived();
    } catch (caught) {
      setError(procurementError(caught, messages.procurement.receiveError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProcurementDrawer
      busy={busy}
      onClose={onClose}
      subtitle={messages.procurement.receiveSubtitle}
      title={messages.procurement.receiveTitle}
    >
      <form
        className="procurement-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <div className="procurement-receipt-summary">
          <div>
            <span>{messages.procurement.supplier}</span>
            <strong>{order.supplierName}</strong>
          </div>
          <div>
            <span>{messages.procurement.warehouse}</span>
            <strong>{order.warehouseName}</strong>
          </div>
        </div>
        <label>
          <span>{messages.procurement.deliveryReference}</span>
          <input
            maxLength={120}
            onChange={(event) => setSupplierDeliveryReference(event.target.value)}
            placeholder="Optional"
            value={supplierDeliveryReference}
          />
        </label>
        <section className="procurement-receive-lines">
          {dueLines.map((line) => {
            const draft = lines.find((item) => item.orderLineId === line.id);
            const product = referenceData.products.find((item) => item.id === line.productId);
            if (!draft) return null;
            return (
              <fieldset className="procurement-receive-line" key={line.id}>
                <legend>
                  <label>
                    <input
                      checked={draft.include}
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { include: event.target.checked })
                      }
                      type="checkbox"
                    />
                    <span>{line.productName}</span>
                  </label>
                </legend>
                <p>{subtractDecimal(line.orderedQuantity, line.deliveredQuantity)} remaining</p>
                <div className="procurement-form-grid">
                  <label>
                    <span>{messages.procurement.quantity}</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      max={subtractDecimal(line.orderedQuantity, line.deliveredQuantity)}
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { quantity: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include}
                      value={draft.quantity}
                    />
                  </label>
                  <label>
                    <span>{messages.procurement.unitCostBgn}</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { unitCostBgn: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include && order.currencyCode !== 'BGN'}
                      value={draft.unitCostBgn}
                    />
                  </label>
                </div>
                {product?.trackingMode === 'serial' ? (
                  <label>
                    <span>{messages.procurement.serialNumbers}</span>
                    <textarea
                      disabled={!draft.include}
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, {
                          serialNumbers: event.target.value,
                        })
                      }
                      required={draft.include}
                      rows={3}
                      value={draft.serialNumbers}
                    />
                  </label>
                ) : null}
                {product?.trackingMode === 'batch' ? (
                  <div className="procurement-form-grid">
                    <label>
                      <span>{messages.procurement.batchNumber}</span>
                      <input
                        disabled={!draft.include}
                        onChange={(event) =>
                          updateReceiptLine(setLines, line.id, {
                            batchNumber: event.target.value,
                          })
                        }
                        required={draft.include}
                        value={draft.batchNumber}
                      />
                    </label>
                    {product.requiresExpiry ? (
                      <label>
                        <span>{messages.procurement.expiresAt}</span>
                        <input
                          disabled={!draft.include}
                          onChange={(event) =>
                            updateReceiptLine(setLines, line.id, {
                              expiresAt: event.target.value,
                            })
                          }
                          required={draft.include}
                          type="date"
                          value={draft.expiresAt}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            );
          })}
        </section>
        <div className="security-drawer-actions">
          <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
            {messages.procurement.close}
          </Button>
          <Button disabled={busy} type="submit">
            {busy ? 'Recording delivery' : messages.procurement.receive}
          </Button>
        </div>
      </form>
    </ProcurementDrawer>
  );
}

function ProcurementDrawer({
  busy,
  children,
  onClose,
  subtitle,
  title,
}: {
  busy: boolean;
  children: React.ReactNode;
  onClose: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer" role="presentation">
      <button
        aria-label={messages.procurement.close}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide procurement-drawer"
        role="dialog"
      >
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button aria-label={messages.procurement.close} disabled={busy} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function useProcurementData(token: string, status?: PurchaseOrderStatus) {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [referenceData, setReferenceData] = useState<ProcurementReferenceData>({
    products: [],
    suppliers: [],
    warehouses: [],
  });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([
      getProcurementReferenceData(token),
      listPurchaseOrders(token, { page: 1, pageSize: 100, ...(status ? { status } : {}) }),
    ])
      .then(([references, page]) => {
        if (!active) return;
        setReferenceData(references);
        setOrders(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, status, token]);
  return { error, loading, orders, referenceData, reload, total };
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} required value={value}>
        {!options.length ? <option value="">Unavailable</option> : null}
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function ProcurementLoading() {
  return (
    <div aria-live="polite" className="procurement-loading">
      <span />
      <span />
      <span />
      <p>{messages.procurement.loading}</p>
    </div>
  );
}

function ProcurementState({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="procurement-state">
      <span className="workflow-empty-icon">
        <Icon name="procurement" size={22} />
      </span>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function emptyOrderLine(referenceData: ProcurementReferenceData): OrderLineDraft {
  return {
    expectedDeliveryDate: '',
    key: crypto.randomUUID(),
    productId: referenceData.products[0]?.id ?? '',
    quantity: '1',
    unitPrice: '',
  };
}

function completeOrderLine(line: OrderLineDraft) {
  return line.productId && line.quantity && line.unitPrice && line.expectedDeliveryDate;
}

function updateOrderLine(
  setLines: React.Dispatch<React.SetStateAction<OrderLineDraft[]>>,
  key: string,
  update: Partial<OrderLineDraft>,
) {
  setLines((current) => current.map((line) => (line.key === key ? { ...line, ...update } : line)));
}

function updateReceiptLine(
  setLines: React.Dispatch<React.SetStateAction<ReceiptLineDraft[]>>,
  lineId: string,
  update: Partial<ReceiptLineDraft>,
) {
  setLines((current) =>
    current.map((line) => (line.orderLineId === lineId ? { ...line, ...update } : line)),
  );
}

function splitSerialNumbers(value: string) {
  return value
    .split(/[\n,]/u)
    .map((serial) => serial.trim())
    .filter(Boolean);
}

function procurementError(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) return fallback;
  const errors: Record<string, string> = {
    BATCH_TRACKING_REQUIRED: 'Enter the supplier batch number for each received batch.',
    EXPIRY_REQUIRED: 'Enter the expiry date for each received batch.',
    PROCUREMENT_PRODUCT_NOT_FOUND: 'A selected product is no longer available.',
    PURCHASE_ORDER_OVER_RECEIPT: 'A quantity is greater than the amount still due.',
    RECEIPT_BGN_COST_REQUIRED: 'Enter the BGN valuation cost for this foreign-currency order.',
    SERIAL_TRACKING_REQUIRED: 'Enter one serial number for every received serialised item.',
  };
  return errors[caught.code] ?? fallback;
}

function statusLabel(status: PurchaseOrderStatus) {
  if (status === 'partially_received') return messages.procurement.partiallyReceived;
  if (status === 'received') return messages.procurement.received;
  return messages.procurement.open;
}

function formatOrderTotal(order: PurchaseOrder) {
  const total = order.lines.reduce(
    (sum, line) => sum + Number(line.orderedQuantity) * Number(line.unitPrice),
    0,
  );
  return formatMoney(total.toFixed(2), order.currencyCode);
}

function formatMoney(value: string, currencyCode: string) {
  try {
    return new Intl.NumberFormat(undefined, { currency: currencyCode, style: 'currency' }).format(
      Number(value),
    );
  } catch {
    return `${Number(value).toFixed(2)} ${currencyCode}`;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(`${value}T00:00:00`),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function shortIdentity(value: string) {
  return `PO · ${value.slice(0, 8).toUpperCase()}`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0')}`);
}

function subtractDecimal(left: string, right: string) {
  const units = decimalUnits(left) - decimalUnits(right);
  const text = units.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}
