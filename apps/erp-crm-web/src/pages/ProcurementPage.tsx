import { Button, InlineAlert } from '@vista/ui';
import type {
  AcceptanceProtocol,
  CreatePurchaseOrderRequest,
  GoodsReceipt,
  ProcurementReferenceData,
  PurchaseOrder,
  PurchaseOrderStatus,
  ReceivePurchaseOrderRequest,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useState } from 'react';

import { ApiClientError } from '../api/client';
import {
  createAcceptanceProtocol,
  getAcceptanceProtocol,
  createPurchaseOrder,
  getProcurementReferenceData,
  listPurchaseOrders,
  receivePurchaseOrder,
} from '../api/procurement';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { TechnicalIdentifier } from '../components/TechnicalIdentifier';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  formatOperationsNumber,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { messages } from '../i18n/legacyMessages';
import { isMaterialCostVariance } from './procurement-cost-variance';
import { ProcurementWorkspace } from './SupplierProcurementPage';

export type ProcurementView = 'goods-receipts' | 'purchase-orders';

export function ProcurementPage({ view }: { view: ProcurementView }) {
  const { hasPermission, session } = useAuth();
  useLocalization();
  const token = session?.sessionToken ?? '';
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const data = useProcurementData(token, status || undefined);
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [protocolTarget, setProtocolTarget] = useState<{
    order: PurchaseOrder;
    receipt: GoodsReceipt;
  } | null>(null);
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

      <ProcurementWorkspace
        countLabel={
          view === 'purchase-orders'
            ? messages.procurement.orderCount(data.total)
            : messages.procurement.receiptCount(receipts.length)
        }
        description={
          view === 'purchase-orders'
            ? messages.procurement.orderRegisterHint
            : messages.procurement.receiptRegisterHint
        }
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        title={
          view === 'purchase-orders'
            ? messages.procurement.orderRegister
            : messages.procurement.receiptRegister
        }
        view={view}
      >
        {view === 'purchase-orders' ? (
          <>
            <section className="procurement-toolbar" aria-label={messages.procurement.orderFilters}>
              <label>
                <span>{messages.procurement.status}</span>
                <select
                  onChange={(event) => setStatus(event.target.value as PurchaseOrderStatus | '')}
                  value={status}
                >
                  <option value="">{messages.procurement.allStatuses}</option>
                  <option value="open">{messages.procurement.open}</option>
                  <option value="partially_received">
                    {messages.procurement.partiallyReceived}
                  </option>
                  <option value="received">{messages.procurement.received}</option>
                </select>
              </label>
            </section>
            {data.orders.length ? (
              <section className="procurement-order-list" aria-label={messages.procurement.orders}>
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
          <section className="procurement-receipt-list" aria-label={messages.procurement.receipts}>
            {receipts.map(({ order, receipt }) => (
              <article className="procurement-receipt-card" key={receipt.id}>
                <div className="procurement-receipt-mark">
                  <Icon name="warehouse" size={18} />
                </div>
                <div>
                  <strong>{order.supplierName}</strong>
                  <div className="procurement-receipt-meta">
                    <span>
                      {receipt.supplierDeliveryReference ?? messages.procurement.goodsReceiptRecord}{' '}
                      · {formatDateTime(receipt.receivedAt)}
                    </span>
                    <TechnicalIdentifier kind="goodsReceipt" value={receipt.id} />
                  </div>
                </div>
                <div>
                  <strong>{receipt.lines.length}</strong>
                  <span>{messages.procurement.productLineCount(receipt.lines.length)}</span>
                </div>
                <div>
                  <strong>{order.warehouseName}</strong>
                  <span>{messages.procurement.warehouse}</span>
                </div>
                {canCreate || receipt.acceptanceProtocol ? (
                  <div className="procurement-receipt-action">
                    <Button
                      onClick={() => setProtocolTarget({ order, receipt })}
                      variant={receipt.acceptanceProtocol ? 'secondary' : 'primary'}
                    >
                      {receipt.acceptanceProtocol
                        ? messages.procurement.viewAcceptanceProtocol
                        : messages.procurement.protocolCreate}
                    </Button>
                    {receipt.acceptanceProtocol ? (
                      <small>{receipt.acceptanceProtocol.protocolNumber}</small>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        ) : (
          <ProcurementState title={messages.procurement.emptyReceipts}>
            <p>{messages.procurement.emptyReceiptsHint}</p>
          </ProcurementState>
        )}
      </ProcurementWorkspace>

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
      {protocolTarget ? (
        <AcceptanceProtocolDrawer
          canCreate={canCreate}
          onClose={() => setProtocolTarget(null)}
          onCreated={(protocol) => {
            setNotice(messages.procurement.acceptanceProtocolCreated);
            data.reload();
            setProtocolTarget((current) =>
              current
                ? { ...current, receipt: { ...current.receipt, acceptanceProtocol: protocol } }
                : current,
            );
          }}
          order={protocolTarget.order}
          receipt={protocolTarget.receipt}
          token={token}
        />
      ) : null}
    </div>
  );
}

function AcceptanceProtocolDrawer({
  canCreate,
  onClose,
  onCreated,
  order,
  receipt,
  token,
}: {
  canCreate: boolean;
  onClose: () => void;
  onCreated: (protocol: AcceptanceProtocol) => void;
  order: PurchaseOrder;
  receipt: GoodsReceipt;
  token: string;
}) {
  const [protocol, setProtocol] = useState<AcceptanceProtocol | null>(null);
  const [supplierInvoiceId, setSupplierInvoiceId] = useState(order.supplierInvoices[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(receipt.acceptanceProtocol));
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!receipt.acceptanceProtocol) return;
    let active = true;
    setLoading(true);
    setError(null);
    void getAcceptanceProtocol(token, receipt.id)
      .then((result) => {
        if (active) setProtocol(result);
      })
      .catch(() => {
        if (active) setError(messages.procurement.acceptanceProtocolLoadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, receipt.acceptanceProtocol, receipt.id, token]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createAcceptanceProtocol(token, receipt.id, crypto.randomUUID(), {
        ...(supplierInvoiceId ? { supplierInvoiceId } : {}),
      });
      setProtocol(result);
      onCreated(result);
    } catch (caught) {
      setError(procurementError(caught, messages.procurement.acceptanceProtocolCreateError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProcurementDrawer
      actions={
        <>
          <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
            {messages.procurement.back}
          </Button>
          {protocol ? (
            <Button disabled={loading} onClick={() => window.print()} type="button">
              {messages.procurement.printProtocol}
            </Button>
          ) : canCreate ? (
            <Button disabled={busy || loading} form="acceptance-protocol-form" type="submit">
              {busy ? messages.procurement.saving : messages.procurement.protocolCreate}
            </Button>
          ) : null}
        </>
      }
      busy={busy}
      drawerClassName="acceptance-protocol-drawer"
      onClose={onClose}
      subtitle={protocol?.protocolNumber ?? receipt.supplierDeliveryReference ?? order.supplierName}
      title={messages.procurement.acceptanceProtocol}
    >
      {loading ? (
        <div className="procurement-state" role="status">
          <h2>{messages.procurement.protocolLoading}</h2>
        </div>
      ) : protocol ? (
        <AcceptanceProtocolDocument protocol={protocol} />
      ) : (
        <form
          className="procurement-form acceptance-protocol-create-form"
          id="acceptance-protocol-form"
          onSubmit={(event) => void create(event)}
        >
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <section className="procurement-receipt-summary">
            <div>
              <span>{messages.procurement.supplier}</span>
              <strong>{order.supplierName}</strong>
            </div>
            <div>
              <span>{messages.procurement.protocolWarehouse}</span>
              <strong>{order.warehouseName}</strong>
            </div>
            <div>
              <span>{messages.procurement.protocolReceived}</span>
              <strong>{formatDateTime(receipt.receivedAt)}</strong>
            </div>
          </section>
          {order.supplierInvoices.length ? (
            <label>
              <span>{messages.procurement.invoice}</span>
              <select
                aria-label={messages.procurement.invoice}
                onChange={(event) => setSupplierInvoiceId(event.target.value)}
                value={supplierInvoiceId}
              >
                <option value="">{messages.procurement.protocolOptional}</option>
                {order.supplierInvoices.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.invoiceNumber} · {formatDate(invoice.invoiceDate)}
                  </option>
                ))}
              </select>
              <small>{messages.procurement.protocolInvoiceHint}</small>
            </label>
          ) : (
            <InlineAlert tone="info">{messages.procurement.protocolNoInvoice}</InlineAlert>
          )}
          <section className="acceptance-protocol-receipt-lines">
            <h3>{messages.procurement.receiptProducts}</h3>
            {receipt.lines.map((line) => {
              const orderLine = order.lines.find((item) => item.id === line.orderLineId);
              return (
                <article key={line.id}>
                  <strong>{orderLine?.productName ?? line.productId}</strong>
                  <span>
                    {messages.procurement.acceptedQuantity}: {line.quantity}
                  </span>
                </article>
              );
            })}
          </section>
          <p className="acceptance-protocol-note">{messages.procurement.protocolImmutableHint}</p>
        </form>
      )}
      {error && protocol ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {error && receipt.acceptanceProtocol ? (
        <Button
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          type="button"
          variant="secondary"
        >
          {messages.procurement.retry}
        </Button>
      ) : null}
    </ProcurementDrawer>
  );
}

function AcceptanceProtocolDocument({ protocol }: { protocol: AcceptanceProtocol }) {
  return (
    <article
      aria-label={messages.procurement.acceptanceProtocol}
      className="acceptance-protocol-print"
    >
      <header className="acceptance-protocol-title">
        <div>
          <p className="page-eyebrow">{messages.procurement.acceptanceProtocol}</p>
          <h2>{protocol.protocolNumber}</h2>
          <p>{protocol.supplierName}</p>
        </div>
        <span>{formatDateTime(protocol.receivedAt)}</span>
      </header>
      <dl className="acceptance-protocol-meta">
        <div>
          <dt>{messages.procurement.protocolWarehouse}</dt>
          <dd>{protocol.warehouseName}</dd>
        </div>
        <div>
          <dt>{messages.procurement.protocolReceived}</dt>
          <dd>{protocol.receivedByName}</dd>
        </div>
        <div>
          <dt>{messages.procurement.protocolPrepared}</dt>
          <dd>{protocol.preparedByName}</dd>
        </div>
        {protocol.supplierDeliveryReference ? (
          <div>
            <dt>{messages.procurement.deliveryReference}</dt>
            <dd>{protocol.supplierDeliveryReference}</dd>
          </div>
        ) : null}
        {protocol.supplierInvoice ? (
          <div>
            <dt>{messages.procurement.invoice}</dt>
            <dd>
              {protocol.supplierInvoice.invoiceNumber} ·{' '}
              {formatDate(protocol.supplierInvoice.invoiceDate)}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="acceptance-protocol-table-scroll">
        <table className="acceptance-protocol-table">
          <thead>
            <tr>
              <th>{messages.procurement.product}</th>
              <th>{messages.procurement.orderedQuantity}</th>
              <th>{messages.procurement.previouslyReceived}</th>
              <th>{messages.procurement.acceptedQuantity}</th>
              <th>{messages.procurement.cumulativeReceived}</th>
              <th>{messages.procurement.outstandingQuantity}</th>
              <th>{messages.procurement.protocolUnitPrice}</th>
              <th>{messages.procurement.protocolSerials}</th>
            </tr>
          </thead>
          <tbody>
            {protocol.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <strong>{line.productName}</strong>
                  <small>{line.productCode}</small>
                </td>
                <td>{line.orderedQuantity}</td>
                <td>{line.previouslyReceivedQuantity}</td>
                <td>{line.acceptedQuantity}</td>
                <td>{line.cumulativeReceivedQuantity}</td>
                <td>{line.outstandingQuantity}</td>
                <td>{formatMoney(line.unitPrice, line.currencyCode)}</td>
                <td>
                  {line.serialNumbers.length ? line.serialNumbers.join(', ') : null}
                  {line.batchNumber ? <span>{line.batchNumber}</span> : null}
                  {line.expiresAt ? <span>{formatDate(line.expiresAt)}</span> : null}
                  {!line.serialNumbers.length && !line.batchNumber && !line.expiresAt
                    ? messages.procurement.protocolNone
                    : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="acceptance-protocol-discrepancies">
        <h3>{messages.procurement.discrepancies}</h3>
        {protocol.lines.some((line) => line.discrepancies.length) ? (
          <ul>
            {protocol.lines.flatMap((line) =>
              line.discrepancies.map((discrepancy) => (
                <li key={discrepancy.claimId}>
                  <strong>{discrepancyTypeLabel(discrepancy.claimType)}</strong>
                  <span>{discrepancy.description}</span>
                  <small>
                    {discrepancy.quantity} · {discrepancyStatusLabel(discrepancy.status)}
                  </small>
                </li>
              )),
            )}
          </ul>
        ) : (
          <p>{messages.procurement.protocolNoDiscrepancies}</p>
        )}
      </section>
      <footer className="acceptance-protocol-signoff">
        <div>
          <span>{messages.procurement.protocolReceived}</span>
          <strong>{protocol.receivedByName}</strong>
        </div>
        <div>
          <span>{messages.procurement.protocolPrepared}</span>
          <strong>{protocol.preparedByName}</strong>
        </div>
      </footer>
    </article>
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
          <div className="procurement-order-reference">
            <span className="procurement-order-id">
              {messages.procurement.order} · {formatDateTime(order.createdAt)}
            </span>
            <TechnicalIdentifier kind="purchaseOrder" value={order.id} />
          </div>
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
      <div
        className="procurement-line-table"
        role="table"
        aria-label={messages.procurement.orderLines}
      >
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
  const [currencyCode, setCurrencyCode] = useState('EUR');
  const [lines, setLines] = useState<OrderLineDraft[]>([emptyOrderLine(referenceData)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit =
    Boolean(supplierPartnerId && warehouseId && currencyCode) &&
    lines.length > 0 &&
    lines.every(completeOrderLine);

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
      actions={
        <>
          <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
            {messages.procurement.close}
          </Button>
          <Button disabled={busy || !canSubmit} form="purchase-order-form" type="submit">
            {busy ? messages.procurement.saving : messages.procurement.save}
          </Button>
        </>
      }
      busy={busy}
      drawerClassName="purchase-order-drawer"
      onClose={onClose}
      subtitle={messages.procurement.orderSubtitle}
      title={messages.procurement.orderTitle}
    >
      <form
        className="procurement-form procurement-order-form"
        id="purchase-order-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!referenceData.suppliers.length ||
        !referenceData.warehouses.length ||
        !referenceData.products.length ? (
          <InlineAlert tone="warning">{messages.procurement.addRequirements}</InlineAlert>
        ) : null}
        <section
          aria-labelledby="purchase-order-details-heading"
          className="procurement-order-details"
        >
          <header className="procurement-order-section-heading">
            <div>
              <h3 id="purchase-order-details-heading">{messages.procurement.orderDetails}</h3>
              <p>{messages.procurement.orderDetailsHint}</p>
            </div>
          </header>
          <div className="procurement-order-details-grid">
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
            <label className="procurement-currency-field">
              <span>{messages.procurement.currency}</span>
              <input
                aria-describedby="purchase-order-currency-hint"
                maxLength={3}
                onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
                required
                value={currencyCode}
              />
              <small id="purchase-order-currency-hint">{messages.procurement.currencyHint}</small>
            </label>
          </div>
        </section>

        <section className="procurement-lines-editor">
          <header>
            <div>
              <h3>{messages.procurement.orderProducts}</h3>
              <p>{messages.procurement.orderProductHint}</p>
            </div>
            <Button
              disabled={lines.length >= referenceData.products.length}
              onClick={() =>
                setLines((current) => [
                  ...current,
                  emptyOrderLine(
                    referenceData,
                    current.map((line) => line.productId),
                  ),
                ])
              }
              type="button"
              variant="secondary"
            >
              <Icon name="plus" size={16} />
              {lines.length >= referenceData.products.length
                ? messages.procurement.allProductsAdded
                : messages.procurement.addLine}
            </Button>
          </header>
          {lines.map((line, index) => (
            <article className="procurement-order-line-editor" key={line.key}>
              <header>
                <div>
                  <span>{messages.procurement.line}</span>
                  <strong>{index + 1}</strong>
                </div>
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
              </header>
              <div className="procurement-order-line-fields">
                <SelectField
                  label={messages.procurement.product}
                  onChange={(value) => updateOrderLine(setLines, line.key, { productId: value })}
                  options={orderProductOptions(referenceData, lines, line.key)}
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
              </div>
            </article>
          ))}
        </section>
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
  unitCostEur: string;
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
      unitCostEur: order.currencyCode === 'EUR' ? line.unitPrice : '',
    })),
  );
  const [supplierDeliveryReference, setSupplierDeliveryReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const includedLineCount = lines.filter((line) => line.include).length;

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
        ...(line.unitCostEur ? { unitCostEur: line.unitCostEur } : {}),
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
      actions={
        <>
          <Button disabled={busy} onClick={onClose} type="button" variant="quiet">
            {messages.procurement.close}
          </Button>
          <Button disabled={busy} form="goods-receipt-form" type="submit">
            {busy ? 'Recording delivery' : messages.procurement.receive}
          </Button>
        </>
      }
      busy={busy}
      drawerClassName="goods-receipt-drawer"
      onClose={onClose}
      subtitle={messages.procurement.receiveSubtitle}
      title={messages.procurement.receiveTitle}
    >
      <form
        className="procurement-form"
        id="goods-receipt-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section
          aria-label={messages.procurement.receiptDestination}
          className="procurement-receipt-summary"
        >
          <div>
            <span>{messages.procurement.supplier}</span>
            <strong>{order.supplierName}</strong>
          </div>
          <div>
            <span>{messages.procurement.warehouse}</span>
            <strong>{order.warehouseName}</strong>
          </div>
        </section>
        <label className="procurement-delivery-reference-field">
          <span>{messages.procurement.deliveryReference}</span>
          <input
            maxLength={120}
            onChange={(event) => setSupplierDeliveryReference(event.target.value)}
            placeholder={messages.procurement.optional}
            value={supplierDeliveryReference}
          />
        </label>
        <section aria-labelledby="receipt-products-heading" className="procurement-receive-lines">
          <header className="procurement-receive-lines-heading">
            <div>
              <h3 id="receipt-products-heading">{messages.procurement.receiptProducts}</h3>
              <p>{messages.procurement.receiptProductsHint}</p>
            </div>
            <span>{messages.procurement.selectedCount(includedLineCount, dueLines.length)}</span>
          </header>
          {dueLines.map((line) => {
            const draft = lines.find((item) => item.orderLineId === line.id);
            const product = referenceData.products.find((item) => item.id === line.productId);
            if (!draft) return null;
            const remainingQuantity = subtractDecimal(line.orderedQuantity, line.deliveredQuantity);
            const remainingId = `receipt-line-${line.id}-remaining`;
            const hasUnitCostVariance =
              draft.include &&
              order.currencyCode === 'EUR' &&
              Boolean(line.costBaselineEur) &&
              isReceiptCost(draft.unitCostEur) &&
              isMaterialCostVariance(line.costBaselineEur, draft.unitCostEur);
            return (
              <article
                className={`procurement-receive-line${draft.include ? '' : ' is-excluded'}`}
                key={line.id}
              >
                <header>
                  <label className="procurement-receive-toggle">
                    <input
                      aria-describedby={remainingId}
                      checked={draft.include}
                      className="procurement-receive-checkbox"
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { include: event.target.checked })
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{line.productName}</strong>
                      <small id={remainingId}>
                        {messages.procurement.remainingToReceive(remainingQuantity)}
                      </small>
                    </span>
                  </label>
                </header>
                <div className="procurement-form-grid procurement-receive-line-fields">
                  <label>
                    <span>{messages.procurement.quantity}</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      max={remainingQuantity}
                      min="0.0001"
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { quantity: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include}
                      value={draft.quantity}
                    />
                  </label>
                  <label>
                    <span>{messages.procurement.unitCostEur}</span>
                    <input
                      disabled={!draft.include}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateReceiptLine(setLines, line.id, { unitCostEur: event.target.value })
                      }
                      pattern="\d+(\.\d{1,4})?"
                      required={draft.include && order.currencyCode !== 'EUR'}
                      value={draft.unitCostEur}
                    />
                  </label>
                </div>
                {hasUnitCostVariance ? (
                  <div className="procurement-price-variance">
                    <InlineAlert tone="warning">
                      {messages.procurement.priceVariance(
                        formatMoney(line.costBaselineEur!, 'EUR'),
                        formatMoney(draft.unitCostEur, 'EUR'),
                        line.costBaselineSource === 'supplier_invoice'
                          ? messages.procurement.latestSupplierInvoice
                          : messages.procurement.latestProductCost,
                        Math.abs(
                          (Number(draft.unitCostEur) / Number(line.costBaselineEur!) - 1) * 100,
                        ).toFixed(1),
                      )}
                    </InlineAlert>
                  </div>
                ) : null}
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
                      placeholder={messages.procurement.serialNumbersPlaceholder}
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
              </article>
            );
          })}
        </section>
      </form>
    </ProcurementDrawer>
  );
}

function ProcurementDrawer({
  actions,
  busy,
  children,
  drawerClassName,
  onClose,
  subtitle,
  title,
}: {
  actions: React.ReactNode;
  busy: boolean;
  children: React.ReactNode;
  drawerClassName?: string;
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
        className={`security-drawer is-wide procurement-drawer${drawerClassName ? ` ${drawerClassName}` : ''}`}
        role="dialog"
      >
        <header className="procurement-drawer-header">
          <button
            aria-label={messages.procurement.backLabel}
            className="procurement-back-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} /> {messages.procurement.back}
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button
            aria-label={messages.procurement.close}
            className="procurement-close-button"
            disabled={busy}
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="security-drawer-body">{children}</div>
        <footer className="procurement-drawer-actions">{actions}</footer>
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
        {!options.length ? <option value="">{messages.procurement.unavailable}</option> : null}
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

function emptyOrderLine(
  referenceData: ProcurementReferenceData,
  excludedProductIds: Iterable<string> = [],
): OrderLineDraft {
  const excluded = new Set(excludedProductIds);
  return {
    expectedDeliveryDate: '',
    key: crypto.randomUUID(),
    productId: referenceData.products.find((product) => !excluded.has(product.id))?.id ?? '',
    quantity: '1',
    unitPrice: '',
  };
}

function orderProductOptions(
  referenceData: ProcurementReferenceData,
  lines: OrderLineDraft[],
  currentLineKey: string,
): Array<[string, string]> {
  const used = new Set(
    lines.filter((line) => line.key !== currentLineKey).map((line) => line.productId),
  );
  return referenceData.products
    .filter((product) => !used.has(product.id))
    .map((product) => [product.id, `${product.productCode} · ${product.name}`]);
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
  const errors: Record<string, string> = messages.procurement.errors;
  const mapped = errors[caught.code];
  if (mapped) return mapped;
  if (caught.message !== 'Request validation failed') return caught.message;
  const details = caught.details.map((detail) => detail.message).join(' ');
  if (details.includes('currencyCode')) return messages.procurement.errors.currencyCode;
  if (details.includes('expectedDeliveryDate'))
    return messages.procurement.errors.expectedDeliveryDate;
  if (details.includes('productId')) return messages.procurement.errors.productId;
  if (details.includes('quantity')) return messages.procurement.errors.quantity;
  if (details.includes('supplierPartnerId')) return messages.procurement.errors.supplierPartnerId;
  if (details.includes('unitPrice')) return messages.procurement.errors.unitPrice;
  if (details.includes('warehouseId')) return messages.procurement.errors.warehouseId;
  return fallback;
}

function statusLabel(status: PurchaseOrderStatus) {
  if (status === 'partially_received') return messages.procurement.partiallyReceived;
  if (status === 'received') return messages.procurement.received;
  return messages.procurement.open;
}

function discrepancyTypeLabel(
  type: AcceptanceProtocol['lines'][number]['discrepancies'][number]['claimType'],
) {
  return type === 'damaged'
    ? messages.procurement.discrepancyDamaged
    : messages.procurement.discrepancyNonConforming;
}

function discrepancyStatusLabel(
  status: AcceptanceProtocol['lines'][number]['discrepancies'][number]['status'],
) {
  return messages.procurement.discrepancyStatuses[status];
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
    return formatOperationsCurrency(value, currencyCode);
  } catch {
    return `${formatOperationsNumber(Number(value), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`;
  }
}

function formatDate(value: string) {
  return formatOperationsDate(new Date(`${value}T00:00:00`), { dateStyle: 'medium' });
}

function formatDateTime(value: string) {
  return formatOperationsDate(new Date(value), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatQuantity(value: number) {
  return formatOperationsNumber(value, { maximumFractionDigits: 4 });
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0')}`);
}

function isReceiptCost(value: string): boolean {
  return /^\d+(\.\d{1,4})?$/u.test(value);
}

function subtractDecimal(left: string, right: string) {
  const units = decimalUnits(left) - decimalUnits(right);
  const text = units.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}
