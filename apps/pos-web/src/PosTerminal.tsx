import type {
  PosCatalogItem,
  PosCustomerLocationOption,
  PosCustomerOption,
  PosSale,
  PosShift,
  PosTerminalContext,
} from '@vista/contracts';
import { useActiveItemVisibility } from '@vista/ui/navigation';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiClientError } from './api/client';
import {
  completePosSale,
  closePosShift,
  getPosCatalog,
  getPosCustomers,
  getPosSales,
  getPosTerminalContext,
  openPosShift,
} from './api/pos';

type PosScreen = 'sales' | 'sell' | 'shifts';
type Notice = { kind: 'error' | 'info' | 'success'; text: string };

const screenLabels: Record<PosScreen, string> = {
  sales: 'Sale history',
  sell: 'Sell',
  shifts: 'Shifts',
};
const screenOrder: PosScreen[] = ['sell', 'sales', 'shifts'];

export function PosTerminal({
  employeeName,
  onSignOut,
  token,
}: {
  employeeName: string;
  onSignOut: () => Promise<void>;
  token: string;
}) {
  const [context, setContext] = useState<PosTerminalContext>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>();
  const [screen, setScreen] = useState<PosScreen>('sell');
  const navigation = useActiveItemVisibility<HTMLElement>(screen);

  const refreshContext = useCallback(async () => {
    try {
      setContext(await getPosTerminalContext(token));
      setNotice(undefined);
    } catch (error) {
      setNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const shift = context?.currentShift;
  const simulator = context?.registers.some((register) => register.fiscalMode === 'simulator');

  return (
    <div className="pos-terminal">
      <header className="pos-topbar">
        <div className="pos-brand">
          <span aria-hidden="true" className="pos-brand-mark">
            <PosIcon name="sell" />
          </span>
          <div>
            <strong>Vista POS</strong>
            <small>{shift ? shift.cashRegisterName : 'Cashier terminal'}</small>
          </div>
        </div>
        <div className="pos-terminal-context">
          <span className="pos-context-label">Signed in as</span>
          <strong>{employeeName}</strong>
        </div>
        <div className="pos-system-status" aria-label="Terminal system status">
          <span className={`pos-status-dot ${shift ? 'is-ready' : 'is-warning'}`} />
          <span>
            {loading ? 'Checking terminal' : shift ? `${shift.shiftNumber} open` : 'Shift closed'}
          </span>
          <button onClick={() => setScreen('shifts')} type="button">
            {shift ? 'View shift' : 'Open shift'}
          </button>
        </div>
        <button className="pos-sign-out-button" onClick={() => void onSignOut()} type="button">
          Sign out
        </button>
      </header>

      <div className="pos-workspace">
        <nav aria-label="POS navigation" className="pos-nav" ref={navigation}>
          {screenOrder.map((item) => (
            <button
              aria-current={screen === item ? 'page' : undefined}
              className={screen === item ? 'is-active' : undefined}
              key={item}
              onClick={() => {
                setScreen(item);
                setNotice(undefined);
              }}
              type="button"
            >
              <PosIcon name={screenIcon(item)} />
              {screenLabels[item]}
            </button>
          ))}
        </nav>

        <main className="pos-main">
          {notice ? <NoticeBar notice={notice} onClose={() => setNotice(undefined)} /> : null}
          {loading ? (
            <PageLoading />
          ) : screen === 'sell' ? (
            <SellScreen onNavigate={setScreen} onNotice={setNotice} shift={shift} token={token} />
          ) : screen === 'shifts' ? (
            <ShiftScreen
              context={context}
              onNavigate={setScreen}
              onNotice={setNotice}
              onOpened={refreshContext}
              token={token}
            />
          ) : (
            <SaleHistory token={token} />
          )}
        </main>
      </div>

      <footer className="pos-footer">
        <span>
          <i className={shift ? 'is-ready' : 'is-warning'} />
          {shift ? `${shift.warehouseName} connected` : 'Open a shift to use stock'}
        </span>
        <span>
          <i className={simulator ? 'is-warning' : 'is-muted'} />
          {simulator ? 'Development receipt simulator' : 'Fiscal device unavailable'}
        </span>
        <span>
          <i className="is-ready" />
          Online sales connected
        </span>
      </footer>
    </div>
  );
}

function SellScreen({
  onNavigate,
  onNotice,
  shift,
  token,
}: {
  onNavigate: (screen: PosScreen) => void;
  onNotice: (notice: Notice) => void;
  shift: PosShift | undefined;
  token: string;
}) {
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [cashTendered, setCashTendered] = useState('');
  const [catalog, setCatalog] = useState<PosCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerSelection>();
  const [paying, setPaying] = useState(false);
  const [query, setQuery] = useState('');
  const [receipt, setReceipt] = useState<PosSale>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [transactionId, setTransactionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!shift) {
      setCatalog([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setCatalogLoading(true);
      setCatalogError(undefined);
      void getPosCatalog(token, {
        ...(customer ? { customerPartnerId: customer.customer.id } : {}),
        ...(query.trim() ? { search: query.trim() } : {}),
        shiftId: shift.id,
      })
        .then((page) => setCatalog(page.items))
        .catch((error) => setCatalogError(messageFor(error)))
        .finally(() => setCatalogLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [customer, query, refreshKey, shift, token]);

  const totals = useMemo(() => basketTotals(basket), [basket]);
  const cashChange = Math.max(0, Number(cashTendered || 0) - totals.gross);
  const blockingIssue = basketIssue(basket, customer, cashTendered, totals.gross);

  function changed(next: BasketLine[]) {
    setBasket(next);
    setTransactionId(crypto.randomUUID());
    setCashTendered('');
  }

  function addItem(item: PosCatalogItem) {
    if (!item.unitPrice || !item.vatTreatment) {
      onNotice({ kind: 'error', text: `${item.name} is not ready for counter sale.` });
      return;
    }
    const current = basket.find((line) => line.item.id === item.id);
    if (current) {
      if (item.trackingMode === 'serial') {
        onNotice({ kind: 'info', text: 'Choose the serial number in the basket before payment.' });
        return;
      }
      const quantityValue = Math.min(current.quantity + 1, Number(item.availableQuantity));
      changed(
        basket.map((line) =>
          line.item.id === item.id ? { ...line, quantity: quantityValue } : line,
        ),
      );
      return;
    }
    changed([...basket, { item, quantity: 1 }]);
  }

  async function pay() {
    if (!shift || blockingIssue) return;
    setPaying(true);
    try {
      const sale = await completePosSale(
        token,
        {
          cashTendered: Number(cashTendered).toFixed(4),
          clientTransactionId: transactionId,
          ...(customer?.location ? { customerLocationId: customer.location.id } : {}),
          ...(customer ? { customerPartnerId: customer.customer.id } : {}),
          lines: basket.map((line) => ({
            ...(line.batchId ? { batchId: line.batchId } : {}),
            productId: line.item.id,
            quantity: line.quantity.toFixed(4),
            ...(line.serialNumber ? { serialNumbers: [line.serialNumber] } : {}),
          })),
          shiftId: shift.id,
        },
        transactionId,
      );
      setReceipt(sale);
      setBasket([]);
      setCashTendered('');
      setTransactionId(crypto.randomUUID());
      setRefreshKey((value) => value + 1);
      onNotice({ kind: 'success', text: `${sale.saleNumber} completed successfully.` });
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="pos-sale-layout">
      <section className="pos-catalog-panel" aria-labelledby="sale-title">
        <header className="pos-page-heading">
          <div>
            <p>Point of sale</p>
            <h1 id="sale-title">New sale</h1>
          </div>
          <button className="pos-quiet-button" onClick={() => onNavigate('shifts')} type="button">
            {shift ? shift.shiftNumber : 'Open shift'}
          </button>
        </header>

        <div className="pos-search-shell">
          <label htmlFor="pos-product-search">Search or scan</label>
          <input
            autoComplete="off"
            disabled={!shift}
            id="pos-product-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Scan barcode, enter product code, or search by name"
            value={query}
          />
          <kbd>F2</kbd>
        </div>

        <div className="pos-catalog-toolbar">
          <div>
            <strong>{query ? 'Search results' : 'Counter catalog'}</strong>
            <span>
              {shift ? `${catalog.length} products · live availability` : 'A shift is required'}
            </span>
          </div>
          {customer ? <span className="pos-price-context">Customer pricing applied</span> : null}
        </div>

        {!shift ? (
          <ActionEmpty
            action="Open cashier shift"
            description="Choose your assigned register and enter the opening cash before starting a sale."
            onAction={() => onNavigate('shifts')}
            title="The counter is closed"
          />
        ) : catalogLoading ? (
          <CatalogLoading />
        ) : catalogError ? (
          <ActionEmpty
            action="Try again"
            description={catalogError}
            onAction={() => setRefreshKey((value) => value + 1)}
            title="Catalog unavailable"
          />
        ) : catalog.length ? (
          <div className="pos-product-grid">
            {catalog.map((item) => (
              <button
                className="pos-product-card"
                disabled={!item.unitPrice || Number(item.availableQuantity) <= 0}
                key={item.id}
                onClick={() => addItem(item)}
                type="button"
              >
                <span className="pos-product-code">{item.productCode}</span>
                <strong>{item.name}</strong>
                <small>
                  {trackingLabel(item)} · {quantity(item.availableQuantity)} {item.unitCode}{' '}
                  available
                </small>
                <span className="pos-product-price">
                  {item.unitPrice ? `${grossUnitPrice(item).toFixed(2)} BGN` : 'Price unavailable'}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <ActionEmpty
            action="Clear search"
            description="Try a product name, product code, or exact barcode."
            onAction={() => setQuery('')}
            title="No products found"
          />
        )}

        <section className="pos-action-strip" aria-label="Sale shortcuts">
          <button disabled={!shift} onClick={() => setCustomerPickerOpen(true)} type="button">
            <kbd>F4</kbd> Customer
          </button>
          <button
            disabled={Boolean(blockingIssue) || paying}
            onClick={() => void pay()}
            type="button"
          >
            <kbd>F12</kbd> Pay cash
          </button>
        </section>
      </section>

      <aside className="pos-basket" aria-label="Current sale basket">
        <header className="pos-basket-header">
          <div>
            <p>Current sale</p>
            <strong>{customer?.customer.name ?? 'Counter customer'}</strong>
            {customer?.location ? <small>{customer.location.name}</small> : null}
          </div>
          <button disabled={!shift} onClick={() => setCustomerPickerOpen(true)} type="button">
            {customer ? 'Change' : 'Add customer'}
          </button>
        </header>

        <div className="pos-basket-lines">
          {basket.length ? (
            basket.map((line) => (
              <BasketRow
                key={line.item.id}
                line={line}
                onChange={(next) =>
                  changed(basket.map((item) => (item.item.id === line.item.id ? next : item)))
                }
                onRemove={() => changed(basket.filter((item) => item.item.id !== line.item.id))}
              />
            ))
          ) : (
            <div className="pos-basket-empty">
              <span aria-hidden="true">0</span>
              <p>No items in this sale</p>
              <small>Choose a product from the counter catalog to begin.</small>
            </div>
          )}
        </div>

        <div className="pos-totals">
          <div>
            <span>Net</span>
            <strong>{money(totals.net)}</strong>
          </div>
          <div>
            <span>VAT</span>
            <strong>{money(totals.vat)}</strong>
          </div>
          <div className="pos-total">
            <span>Total due</span>
            <strong>{money(totals.gross)}</strong>
          </div>
        </div>

        <div className="pos-cash-entry">
          <label htmlFor="cash-tendered">Cash received</label>
          <div>
            <input
              disabled={!basket.length}
              id="cash-tendered"
              inputMode="decimal"
              min="0"
              onChange={(event) => setCashTendered(event.target.value)}
              placeholder="0.00"
              step="0.01"
              type="number"
              value={cashTendered}
            />
            <span>BGN</span>
          </div>
          <p>
            Change <strong>{money(cashChange)}</strong>
          </p>
        </div>
        <button
          className="pos-pay-button"
          disabled={Boolean(blockingIssue) || paying}
          onClick={() => void pay()}
          type="button"
        >
          {paying ? 'Completing sale…' : `Pay cash · ${money(totals.gross)}`}
        </button>
        <p className="pos-basket-disclaimer">{blockingIssue ?? 'Cash payment is ready.'}</p>
      </aside>

      {customerPickerOpen ? (
        <CustomerPicker
          {...(customer ? { current: customer } : {})}
          onClose={() => setCustomerPickerOpen(false)}
          onSelect={(selection) => {
            setCustomer(selection);
            setCustomerPickerOpen(false);
            setTransactionId(crypto.randomUUID());
          }}
          token={token}
        />
      ) : null}
      {receipt ? <ReceiptDialog onClose={() => setReceipt(undefined)} sale={receipt} /> : null}
    </div>
  );
}

interface BasketLine {
  batchId?: string;
  item: PosCatalogItem;
  quantity: number;
  serialNumber?: string;
}
interface CustomerSelection {
  customer: PosCustomerOption;
  location?: PosCustomerLocationOption;
}

function BasketRow({
  line,
  onChange,
  onRemove,
}: {
  line: BasketLine;
  onChange: (line: BasketLine) => void;
  onRemove: () => void;
}) {
  const maximum = Math.max(1, Math.floor(Number(line.item.availableQuantity)));
  return (
    <article className="pos-basket-row">
      <div className="pos-basket-row-heading">
        <div>
          <strong>{line.item.name}</strong>
          <small>{line.item.productCode}</small>
        </div>
        <button aria-label={`Remove ${line.item.name}`} onClick={onRemove} type="button">
          <PosIcon name="close" />
        </button>
      </div>
      {line.item.trackingMode === 'serial' ? (
        <label className="pos-tracking-field">
          <span>Serial number</span>
          <select
            onChange={(event) => onChange(withSerial(line, event.target.value))}
            value={line.serialNumber ?? ''}
          >
            <option value="">Choose available serial</option>
            {line.item.serialNumbers.map((serial) => (
              <option key={serial} value={serial}>
                {serial}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {line.item.trackingMode === 'batch' ? (
        <label className="pos-tracking-field">
          <span>Batch</span>
          <select
            onChange={(event) => onChange(withBatch(line, event.target.value))}
            value={line.batchId ?? ''}
          >
            <option value="">Choose available batch</option>
            {line.item.batches.map((batch) => (
              <option key={batch.batchId} value={batch.batchId}>
                {batch.batchNumber} · {quantity(batch.quantity)} available
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="pos-basket-row-footer">
        {line.item.trackingMode === 'serial' ? (
          <span>1 unit</span>
        ) : (
          <div className="pos-quantity-stepper">
            <button
              aria-label={`Reduce ${line.item.name} quantity`}
              disabled={line.quantity <= 1}
              onClick={() => onChange({ ...line, quantity: line.quantity - 1 })}
              type="button"
            >
              −
            </button>
            <strong>{line.quantity}</strong>
            <button
              aria-label={`Increase ${line.item.name} quantity`}
              disabled={line.quantity >= maximum}
              onClick={() => onChange({ ...line, quantity: line.quantity + 1 })}
              type="button"
            >
              +
            </button>
          </div>
        )}
        <strong>{money(lineGross(line))}</strong>
      </div>
    </article>
  );
}

function CustomerPicker({
  current,
  onClose,
  onSelect,
  token,
}: {
  current?: CustomerSelection;
  onClose: () => void;
  onSelect: (selection?: CustomerSelection) => void;
  token: string;
}) {
  const [customers, setCustomers] = useState<PosCustomerOption[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PosCustomerOption | undefined>(current?.customer);
  const [locationId, setLocationId] = useState(current?.location?.id ?? '');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(undefined);
      void getPosCustomers(token, query.trim() || undefined)
        .then(setCustomers)
        .catch((caught) => setError(messageFor(caught)))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, token]);

  const location = selected?.locations.find((item) => item.id === locationId);
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="customer-picker-title"
        aria-modal="true"
        className="pos-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>Customer profile</p>
            <h2 id="customer-picker-title">Choose customer</h2>
          </div>
          <button aria-label="Close customer search" onClick={onClose} type="button">
            <PosIcon name="close" />
          </button>
        </header>
        <div className="pos-dialog-body">
          <label className="pos-dialog-search">
            <span>Search customers</span>
            <input
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Company, UIC, or VAT number"
              value={query}
            />
          </label>
          {loading ? <p className="pos-dialog-state">Loading customers…</p> : null}
          {error ? <p className="pos-dialog-state is-error">{error}</p> : null}
          {!loading && !error ? (
            <div className="pos-customer-results">
              {customers.map((customer) => (
                <button
                  className={selected?.id === customer.id ? 'is-selected' : undefined}
                  key={customer.id}
                  onClick={() => {
                    setSelected(customer);
                    setLocationId(
                      customer.locations.length === 1 ? (customer.locations[0]?.id ?? '') : '',
                    );
                  }}
                  type="button"
                >
                  <strong>{customer.name}</strong>
                  <span>{customer.uic ? `UIC ${customer.uic}` : 'Customer account'}</span>
                </button>
              ))}
              {!customers.length ? <p className="pos-dialog-state">No customer found.</p> : null}
            </div>
          ) : null}
          {selected ? (
            <fieldset className="pos-location-choice">
              <legend>Receiving location</legend>
              <label>
                <input
                  checked={!locationId}
                  name="location"
                  onChange={() => setLocationId('')}
                  type="radio"
                />
                <span>
                  <strong>Counter sale</strong>
                  <small>No equipment location</small>
                </span>
              </label>
              {selected.locations.map((item) => (
                <label key={item.id}>
                  <input
                    checked={locationId === item.id}
                    name="location"
                    onChange={() => setLocationId(item.id)}
                    type="radio"
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.city}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </div>
        <footer>
          <button
            className="pos-secondary-button"
            onClick={() => onSelect(undefined)}
            type="button"
          >
            Clear customer
          </button>
          <button
            className="pos-primary-button"
            disabled={!selected}
            onClick={() =>
              selected && onSelect({ customer: selected, ...(location ? { location } : {}) })
            }
            type="button"
          >
            Use customer
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReceiptDialog({ onClose, sale }: { onClose: () => void; sale: PosSale }) {
  return (
    <div className="pos-dialog-layer" role="presentation">
      <section
        aria-labelledby="receipt-title"
        aria-modal="true"
        className="pos-dialog pos-receipt"
        role="dialog"
      >
        <header>
          <div>
            <p>Sale complete</p>
            <h2 id="receipt-title">{sale.fiscalReceiptNumber}</h2>
          </div>
          <span className="pos-receipt-check">✓</span>
        </header>
        <div className="pos-dialog-body">
          <div className="pos-simulator-label">
            Development receipt simulator<small>No certified fiscal receipt was issued.</small>
          </div>
          <dl className="pos-receipt-summary">
            <div>
              <dt>Sale</dt>
              <dd>{sale.saleNumber}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(Number(sale.grossTotal))}</dd>
            </div>
            <div>
              <dt>Cash received</dt>
              <dd>{money(Number(sale.cashTendered))}</dd>
            </div>
            <div className="is-change">
              <dt>Change due</dt>
              <dd>{money(Number(sale.changeAmount))}</dd>
            </div>
          </dl>
        </div>
        <footer>
          <button className="pos-primary-button" onClick={onClose} type="button">
            Start next sale
          </button>
        </footer>
      </section>
    </div>
  );
}

function ShiftScreen({
  context,
  onNavigate,
  onNotice,
  onOpened,
  token,
}: {
  context: PosTerminalContext | undefined;
  onNavigate: (screen: PosScreen) => void;
  onNotice: (notice: Notice) => void;
  onOpened: () => Promise<void>;
  token: string;
}) {
  const current = context?.currentShift;
  const [openingCash, setOpeningCash] = useState('100.00');
  const [opening, setOpening] = useState(false);
  const [registerId, setRegisterId] = useState(context?.registers[0]?.id ?? '');
  const [closingCash, setClosingCash] = useState(current?.expectedCashBgn ?? '0.00');
  const [closing, setClosing] = useState(false);

  async function open() {
    if (!registerId || Number(openingCash) < 0) return;
    setOpening(true);
    try {
      await openPosShift(
        token,
        { cashRegisterId: registerId, openingCashBgn: Number(openingCash).toFixed(4) },
        crypto.randomUUID(),
      );
      await onOpened();
      onNotice({ kind: 'success', text: 'Cashier shift opened. The counter is ready.' });
      onNavigate('sell');
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setOpening(false);
    }
  }

  async function close() {
    if (!current || Number(closingCash) < 0) return;
    setClosing(true);
    try {
      await closePosShift(
        token,
        current.id,
        { closingCashBgn: Number(closingCash).toFixed(4), version: current.version },
        crypto.randomUUID(),
      );
      await onOpened();
      onNotice({
        kind: 'success',
        text: 'Cashier shift closed and the drawer count was recorded.',
      });
    } catch (error) {
      onNotice({ kind: 'error', text: messageFor(error) });
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="pos-register-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Cashier shift</h1>
          <span>Open the assigned counter before taking payments or issuing receipts.</span>
        </div>
        {current ? (
          <button className="pos-primary-button" onClick={() => onNavigate('sell')} type="button">
            Return to sale
          </button>
        ) : null}
      </header>
      {current ? (
        <section className="pos-current-shift">
          <div className="pos-current-shift-status">
            <span />
            <div>
              <small>Open shift</small>
              <strong>{current.shiftNumber}</strong>
            </div>
          </div>
          <dl>
            <div>
              <dt>Register</dt>
              <dd>{current.cashRegisterName}</dd>
            </div>
            <div>
              <dt>Warehouse</dt>
              <dd>{current.warehouseName}</dd>
            </div>
            <div>
              <dt>Operator</dt>
              <dd>{current.operatorCode}</dd>
            </div>
            <div>
              <dt>Expected cash</dt>
              <dd>{money(Number(current.expectedCashBgn))}</dd>
            </div>
          </dl>
          <div className="pos-close-shift">
            <label>
              <span>Counted cash</span>
              <div>
                <input
                  min="0"
                  onChange={(event) => setClosingCash(event.target.value)}
                  step="0.01"
                  type="number"
                  value={closingCash}
                />
                <span>BGN</span>
              </div>
            </label>
            <div>
              <p>
                Count the drawer before closing. X/Z reporting will be added with the remaining POS
                reports.
              </p>
              <button
                className="pos-secondary-button"
                disabled={closing || Number(closingCash) < 0}
                onClick={() => void close()}
                type="button"
              >
                {closing ? 'Closing shift…' : 'Close cashier shift'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="pos-open-shift-card">
          <div className="pos-open-shift-step">
            <span>1</span>
            <div>
              <h2>Choose register</h2>
              <p>Only counters assigned to your account are available.</p>
            </div>
          </div>
          <div className="pos-register-options">
            {context?.registers.map((register) => (
              <label
                className={registerId === register.id ? 'is-selected' : undefined}
                key={register.id}
              >
                <input
                  checked={registerId === register.id}
                  name="register"
                  onChange={() => setRegisterId(register.id)}
                  type="radio"
                />
                <span>
                  <strong>{register.name}</strong>
                  <small>{register.businessLocationName}</small>
                  <em>{register.warehouseName}</em>
                </span>
                <i>
                  {register.fiscalMode === 'simulator'
                    ? 'Development simulator'
                    : register.fiscalMode}
                </i>
              </label>
            ))}
          </div>
          <div className="pos-open-shift-step">
            <span>2</span>
            <div>
              <h2>Count opening cash</h2>
              <p>Enter the cash physically available in the drawer.</p>
            </div>
          </div>
          <label className="pos-opening-cash">
            <span>Opening cash</span>
            <div>
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => setOpeningCash(event.target.value)}
                step="0.01"
                type="number"
                value={openingCash}
              />
              <span>BGN</span>
            </div>
          </label>
          <div className="pos-open-shift-actions">
            <p>The simulator is restricted to local development and cannot run in production.</p>
            <button
              className="pos-primary-button"
              disabled={!registerId || opening || Number(openingCash) < 0}
              onClick={() => void open()}
              type="button"
            >
              {opening ? 'Opening shift…' : 'Open cashier shift'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function SaleHistory({ token }: { token: string }) {
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<PosSale[]>([]);

  useEffect(() => {
    void getPosSales(token)
      .then((page) => setSales(page.items))
      .catch((caught) => setError(messageFor(caught)))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="pos-register-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>Sale history</h1>
          <span>Completed sales for this cashier account, with receipt and cash details.</span>
        </div>
      </header>
      {loading ? <PageLoading /> : null}
      {error ? <div className="pos-page-error">{error}</div> : null}
      {!loading && !error && !sales.length ? (
        <ActionEmpty
          description="Completed counter sales will appear here."
          title="No sales recorded"
        />
      ) : null}
      <div className="pos-sale-history">
        {sales.map((sale) => (
          <article key={sale.id}>
            <div className="pos-sale-history-main">
              <span className="pos-sale-avatar">
                <PosIcon name="sales" />
              </span>
              <div>
                <strong>{sale.saleNumber}</strong>
                <small>
                  {sale.customerName ?? 'Counter customer'} · {dateTime(sale.completedAt)}
                </small>
              </div>
            </div>
            <div className="pos-sale-history-receipt">
              <small>Simulated receipt</small>
              <strong>{sale.fiscalReceiptNumber}</strong>
            </div>
            <div className="pos-sale-history-total">
              <small>
                {sale.lines.length} product{sale.lines.length === 1 ? '' : 's'}
              </small>
              <strong>{money(Number(sale.grossTotal))}</strong>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div
      className={`pos-notice is-${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
    >
      <span />
      <p>{notice.text}</p>
      <button aria-label="Dismiss message" onClick={onClose} type="button">
        <PosIcon name="close" />
      </button>
    </div>
  );
}

function ActionEmpty({
  action,
  description,
  onAction,
  title,
}: {
  action?: string;
  description: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <section className="pos-catalog-empty">
      <span className="pos-empty-mark">
        <PosIcon name="scan" />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && onAction ? (
        <button className="pos-primary-button" onClick={onAction} type="button">
          {action}
        </button>
      ) : null}
    </section>
  );
}

function CatalogLoading() {
  return (
    <div aria-label="Loading products" className="pos-product-grid is-loading">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function PageLoading() {
  return (
    <div className="pos-page-loading" role="status">
      Loading current information…
    </div>
  );
}

type PosIconName =
  'close' | 'customers' | 'devices' | 'reports' | 'returns' | 'sales' | 'scan' | 'sell' | 'shifts';

function PosIcon({ name }: { name: PosIconName }) {
  return (
    <svg aria-hidden="true" className="pos-icon" fill="none" viewBox="0 0 24 24">
      {posIconPaths[name]}
    </svg>
  );
}

const posIconPaths: Record<PosIconName, ReactNode> = {
  close: <path d="m6 6 12 12M18 6 6 18" />,
  customers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20v-1.5A3.5 3.5 0 0 1 7 15h4a3.5 3.5 0 0 1 3.5 3.5V20M16 5.5a3 3 0 0 1 0 5.8M17 15a3.5 3.5 0 0 1 3.5 3.5V20" />
    </>
  ),
  devices: <path d="M4 5h16v11H4zM8 20h8M12 16v4M7 9h2m2 0h2" />,
  reports: <path d="M5 20V10m5 10V5m5 15v-7m5 7V8M3 20h19" />,
  returns: <path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 6 6" />,
  sales: <path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h3" />,
  scan: <path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M8 8v8m3-8v8m3-8v8m3-8v8" />,
  sell: <path d="M4 5h16v14H4zM4 10h16M8 15h4" />,
  shifts: <path d="M5 3v3m14-3v3M4 8h16v12H4zM8 12h3m2 0h3M8 16h3" />,
};

function screenIcon(screen: PosScreen): PosIconName {
  if (screen === 'sales') return 'sales';
  if (screen === 'sell') return 'sell';
  return 'shifts';
}

function vatRate(item: PosCatalogItem) {
  if (item.vatTreatment === 'reduced_9') return 0.09;
  if (item.vatTreatment === 'standard_20' || item.vatTreatment === 'ica') return 0.2;
  return 0;
}
function withSerial(line: BasketLine, value: string): BasketLine {
  if (value) return { ...line, serialNumber: value };
  const rest: BasketLine = { item: line.item, quantity: line.quantity };
  return line.batchId ? { ...rest, batchId: line.batchId } : rest;
}
function withBatch(line: BasketLine, value: string): BasketLine {
  if (value) return { ...line, batchId: value };
  const rest: BasketLine = { item: line.item, quantity: line.quantity };
  return line.serialNumber ? { ...rest, serialNumber: line.serialNumber } : rest;
}
function grossUnitPrice(item: PosCatalogItem) {
  return Number(item.unitPrice ?? 0) * (1 + vatRate(item));
}
function lineGross(line: BasketLine) {
  return grossUnitPrice(line.item) * line.quantity;
}
function basketTotals(lines: BasketLine[]) {
  const net = lines.reduce(
    (total, line) => total + Number(line.item.unitPrice ?? 0) * line.quantity,
    0,
  );
  const vat = lines.reduce(
    (total, line) => total + Number(line.item.unitPrice ?? 0) * vatRate(line.item) * line.quantity,
    0,
  );
  return { gross: net + vat, net, vat };
}
function basketIssue(
  lines: BasketLine[],
  customer: CustomerSelection | undefined,
  cashTendered: string,
  gross: number,
) {
  if (!lines.length) return 'Add at least one product.';
  const serial = lines.find((line) => line.item.trackingMode === 'serial');
  if (serial && !serial.serialNumber) return `Choose the serial number for ${serial.item.name}.`;
  if (serial && (!customer || !customer.location))
    return 'Choose the customer and receiving location for serialised equipment.';
  const batch = lines.find((line) => line.item.trackingMode === 'batch' && !line.batchId);
  if (batch) return `Choose the batch for ${batch.item.name}.`;
  if (!cashTendered || Number(cashTendered) < gross) return 'Enter enough cash to cover the total.';
  return undefined;
}
function money(value: number) {
  return `${value.toLocaleString('en-BG', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} BGN`;
}
function quantity(value: string) {
  return Number(value).toLocaleString('en-BG', { maximumFractionDigits: 4 });
}
function trackingLabel(item: PosCatalogItem) {
  return item.trackingMode === 'serial'
    ? 'Serial tracked'
    : item.trackingMode === 'batch'
      ? 'Batch tracked'
      : 'Standard item';
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
function messageFor(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return 'The POS service is unavailable. Check the connection and try again.';
}
