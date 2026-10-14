import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
import type {
  CreateStockReservationRequest,
  IssueStockRequest,
  OrganizationTopology,
  ProductSummary,
  ReceiveStockRequest,
  ReturnStockRequest,
  ReplenishmentStatus,
  StockBalance,
  StockMovementJournalPage,
  StockMovementJournalQuery,
  StockMovementType,
  StockReservation,
  StockReservationPage,
  Stocktake,
  TransferStockRequest,
  Warehouse,
} from '@vista/contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { listProducts } from '../api/catalog';
import { ApiClientError } from '../api/client';
import { getOrganizationTopology } from '../api/organization';
import {
  completeStocktake,
  configureStockSettings,
  createStockReservation,
  createWarehouse,
  issueStock,
  listStockMovements,
  listReplenishment,
  listStockReservations,
  listStockBalances,
  listWarehouses,
  openStocktake,
  receiveStock,
  returnStock,
  recordStocktakeCount,
  releaseStockReservation,
  transferStock,
} from '../api/inventory';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { TechnicalIdentifier } from '../components/TechnicalIdentifier';
import {
  formatOperationsCurrency,
  formatOperationsMinorCurrency,
  formatOperationsNumber,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { Link } from '../routing/Router';
import { SerialTraceabilityPage } from './SerialTraceabilityPage';

export type WarehouseView = 'warehouses' | 'stock' | 'movements' | 'stocktakes' | 'reservations';

export function WarehouseOperationsPage({ view }: { view: WarehouseView }) {
  useLocalization();
  const { hasPermission, session } = useAuth();
  const token = session?.sessionToken ?? '';
  const data = useWarehouseData(token, view === 'stock');
  const permissions = {
    approve: hasPermission('erp.warehouse', 'approve'),
    create: hasPermission('erp.warehouse', 'create'),
    edit: hasPermission('erp.warehouse', 'edit'),
    organization: hasPermission('platform.organization', 'view'),
  };

  if (data.loading) return <WarehouseLoading />;
  if (data.error)
    return (
      <WarehouseState title="Warehouse data could not be loaded">
        <p>Check your connection and try again.</p>
        <Button onClick={data.reload} variant="secondary">
          Try again
        </Button>
      </WarehouseState>
    );

  const common = { ...data, accountId: session?.context.accountId ?? '', permissions, token };
  if (view === 'warehouses') return <WarehousesView {...common} />;
  if (view === 'stock') return <StockView {...common} />;
  if (view === 'movements') return <MovementsView {...common} />;
  if (view === 'stocktakes') return <StocktakesView {...common} />;
  return <ReservationsView {...common} />;
}

interface WarehouseData {
  balances: StockBalance[];
  error: boolean;
  loading: boolean;
  products: ProductSummary[];
  reload: () => void;
  replenishment: ReplenishmentStatus[];
  warehouses: Warehouse[];
}

interface OperationalProps extends WarehouseData {
  accountId: string;
  permissions: { approve: boolean; create: boolean; edit: boolean; organization: boolean };
  token: string;
}

function useWarehouseData(token: string, includeStock: boolean): WarehouseData {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [replenishment, setReplenishment] = useState<ReplenishmentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    const requests = includeStock
      ? Promise.all([
          listWarehouses(token),
          listProducts(token),
          listStockBalances(token),
          listReplenishment(token),
        ])
      : Promise.all([listWarehouses(token), listProducts(token)]).then(
          ([nextWarehouses, nextProducts]) =>
            [nextWarehouses, nextProducts, [], []] as [
              Warehouse[],
              ProductSummary[],
              StockBalance[],
              ReplenishmentStatus[],
            ],
        );
    void requests
      .then(([nextWarehouses, nextProducts, nextBalances, nextReplenishment]) => {
        if (!active) return;
        setWarehouses(nextWarehouses);
        setProducts(nextProducts);
        setBalances(nextBalances);
        setReplenishment(nextReplenishment);
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
  }, [includeStock, revision, token]);

  return { balances, error, loading, products, reload, replenishment, warehouses };
}

function WarehousesView({ permissions, reload, token, warehouses }: OperationalProps) {
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <WarehousePageFrame
      action={
        permissions.create ? (
          <Button onClick={() => setCreating((value) => !value)}>
            {creating ? 'Close setup' : 'Add warehouse'}
          </Button>
        ) : undefined
      }
      description="Create and manage central, service, and mobile technician warehouses without a fixed limit."
      eyebrow="ERP · Warehouse"
      title="Warehouses"
    >
      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      {creating ? (
        <WarehouseCreateForm
          onCreated={(warehouse) => {
            setNotice(`${warehouse.name} was added.`);
            setCreating(false);
            reload();
          }}
          organizationAccess={permissions.organization}
          token={token}
        />
      ) : null}
      {warehouses.length ? (
        <section className="warehouse-directory" aria-label="Active warehouses">
          {warehouses.map((warehouse) => (
            <article key={warehouse.id}>
              <span className={`warehouse-type-mark warehouse-type-${warehouse.type}`}>
                <Icon name="warehouse" size={20} />
              </span>
              <div>
                <strong>{warehouse.name}</strong>
                <small>{warehouse.code}</small>
              </div>
              <span className="warehouse-type-chip">
                {warehouse.type === 'technician' ? 'Technician / mobile' : 'Standard'}
              </span>
            </article>
          ))}
        </section>
      ) : (
        <WarehouseState title="No warehouses configured">
          <p>Add a warehouse before recording stock.</p>
        </WarehouseState>
      )}
    </WarehousePageFrame>
  );
}

function WarehouseCreateForm({
  onCreated,
  organizationAccess,
  token,
}: {
  onCreated: (warehouse: Warehouse) => void;
  organizationAccess: boolean;
  token: string;
}) {
  const [topology, setTopology] = useState<OrganizationTopology | null>(null);
  const [businessLocationId, setBusinessLocationId] = useState('');
  const [technicianOperatorId, setTechnicianOperatorId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Warehouse['type']>('standard');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();

  useEffect(() => {
    if (!organizationAccess) return;
    let active = true;
    void getOrganizationTopology(token)
      .then((result) => {
        if (active) setTopology(result);
      })
      .catch(() => {
        if (active) setTopology(null);
      });
    return () => {
      active = false;
    };
  }, [organizationAccess, token]);

  const eligibleOperators =
    topology?.operators.filter((operator) => operator.businessLocationId === businessLocationId) ??
    [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      ...(businessLocationId ? { businessLocationId } : {}),
      code: code.trim(),
      name: name.trim(),
      ...(technicianOperatorId ? { technicianOperatorId } : {}),
      type,
    };
    if (!input.code || !input.name) return;
    setSaving(true);
    setError(null);
    try {
      onCreated(await createWarehouse(token, attempt(input), input));
    } catch (caught) {
      setError(commandError(caught, 'The warehouse could not be created.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="warehouse-command-card warehouse-create-card"
      onSubmit={(event) => void submit(event)}
    >
      <div className="command-card-heading">
        <div>
          <span>New warehouse</span>
          <h2>Warehouse setup</h2>
        </div>
        <small>Each warehouse code must be unique.</small>
      </div>
      <div className="warehouse-form-grid">
        <TextField
          id="warehouse-code"
          label="Warehouse code"
          maxLength={30}
          onChange={(event) => setCode(event.target.value)}
          required
          value={code}
        />
        <TextField
          id="warehouse-name"
          label="Warehouse name"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <SelectField
          id="warehouse-type"
          label="Custody type"
          onChange={(value) => {
            const nextType = value as Warehouse['type'];
            setType(nextType);
            if (nextType !== 'technician') setTechnicianOperatorId('');
          }}
          value={type}
        >
          <option value="standard">Standard warehouse</option>
          <option value="technician">Technician / mobile warehouse</option>
        </SelectField>
        {topology?.locations.length ? (
          <SelectField
            id="warehouse-business-location"
            label="Business location (optional)"
            onChange={(value) => {
              setBusinessLocationId(value);
              setTechnicianOperatorId('');
            }}
            value={businessLocationId}
          >
            <option value="">Unassigned</option>
            {topology.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        {type === 'technician' && businessLocationId && eligibleOperators.length ? (
          <SelectField
            id="warehouse-technician-operator"
            label="Technician operator (optional)"
            onChange={setTechnicianOperatorId}
            value={technicianOperatorId}
          >
            <option value="">Shared technician custody</option>
            {eligibleOperators.map((operator) => (
              <option key={operator.id} value={operator.id}>
                {operator.code} · {operator.displayName}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="warehouse-form-actions">
        <Button busy={saving} busyLabel="Creating…" type="submit">
          Create warehouse
        </Button>
      </div>
    </form>
  );
}

function StockView({
  accountId,
  balances,
  permissions,
  products,
  reload,
  replenishment,
  token,
  warehouses,
}: OperationalProps) {
  const [warehouseId, setWarehouseId] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const productById = useMemo(() => new Map(products.map((item) => [item.id, item])), [products]);
  const warehouseById = useMemo(
    () => new Map(warehouses.map((item) => [item.id, item])),
    [warehouses],
  );
  const visibleBalances = balances.filter(
    (item) => warehouseId === 'all' || item.warehouseId === warehouseId,
  );
  const visibleReplenishment = replenishment.filter(
    (item) => warehouseId === 'all' || item.warehouseId === warehouseId,
  );
  const totalValue = visibleBalances.reduce(
    (sum, item) => sum + displayedEurMinorUnits(item.inventoryValueEur),
    0n,
  );
  const reserved = visibleBalances.reduce((sum, item) => sum + Number(item.reservedQuantity), 0);
  const lowStock = visibleReplenishment.filter((item) => item.lowStock);
  return (
    <WarehousePageFrame
      action={
        permissions.edit ? (
          <Button onClick={() => setSettingsOpen((value) => !value)}>
            {settingsOpen ? 'Close thresholds' : 'Set stock thresholds'}
          </Button>
        ) : undefined
      }
      description="Monitor physical, reserved, and available inventory with weighted-average EUR valuation and reservation-aware replenishment."
      eyebrow="ERP · Warehouse"
      title="Stock overview"
    >
      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}
      {settingsOpen ? (
        <StockSettingsForm
          accountId={accountId}
          onSaved={() => {
            setNotice('Minimum and target stock controls were updated.');
            setSettingsOpen(false);
            reload();
          }}
          products={products}
          token={token}
          warehouses={warehouses}
        />
      ) : null}
      <section className="inventory-toolbar">
        <SelectField
          id="stock-warehouse-filter"
          label="Warehouse"
          onChange={setWarehouseId}
          value={warehouseId}
        >
          <option value="all">All warehouses</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </SelectField>
        <Link to="/modules/erp.warehouse/movements">
          Post a movement <Icon name="arrow" size={14} />
        </Link>
      </section>
      <section className="inventory-kpis" aria-label="Inventory summary">
        <Metric
          label="Inventory value"
          value={moneyFromEurMinorUnits(totalValue)}
          detail="Weighted-average value in EUR"
        />
        <Metric
          label="Reserved"
          value={quantity(reserved)}
          detail="Committed to active references"
        />
        <Metric
          label="Low-stock lines"
          value={String(lowStock.length)}
          detail="Below configured minimum"
          tone={lowStock.length ? 'warning' : 'positive'}
        />
      </section>
      <section className="inventory-panel">
        <div className="inventory-panel-heading">
          <div>
            <span>Availability</span>
            <h2>Stock by product and warehouse</h2>
          </div>
          <small>{visibleBalances.length} balance lines</small>
        </div>
        {visibleBalances.length ? (
          <div className="inventory-table" role="table" aria-label="Stock balances">
            <div className="inventory-table-head" role="row">
              <span>Product</span>
              <span>Warehouse</span>
              <span>Physical</span>
              <span>Reserved</span>
              <span>Available</span>
              <span>Avg. cost</span>
              <span>Value</span>
            </div>
            {visibleBalances.map((balance) => (
              <div
                className="inventory-table-row"
                role="row"
                key={`${balance.warehouseId}:${balance.productId}`}
              >
                <div>
                  <strong>
                    {productById.get(balance.productId)?.name ?? 'Unavailable product'}
                  </strong>
                  <small>
                    {productById.get(balance.productId)?.productCode ?? 'Code not available'}
                  </small>
                </div>
                <span>
                  {warehouseById.get(balance.warehouseId)?.name ?? 'Unavailable warehouse'}
                </span>
                <span>{quantity(balance.quantity)}</span>
                <span>{quantity(balance.reservedQuantity)}</span>
                <strong>{quantity(balance.availableQuantity)}</strong>
                <span>{money(balance.averageUnitCostEur)}</span>
                <strong>{money(balance.inventoryValueEur)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <EmptyInventory
            title="No stock balances yet"
            detail="Post a receipt to establish the first valued inventory balance."
          />
        )}
      </section>
      <section className="inventory-panel replenishment-panel">
        <div className="inventory-panel-heading">
          <div>
            <span>Replenishment</span>
            <h2>Purchase recommendations</h2>
          </div>
          <small>Based on available quantity</small>
        </div>
        {visibleReplenishment.length ? (
          visibleReplenishment.map((line) => (
            <article
              className={`replenishment-row${line.lowStock ? ' is-low' : ''}`}
              key={`${line.warehouseId}:${line.productId}`}
            >
              <span
                className="replenishment-status"
                aria-label={line.lowStock ? 'Low stock' : 'Stock healthy'}
              />
              <div>
                <strong>{productById.get(line.productId)?.name ?? 'Unavailable product'}</strong>
                <small>
                  {warehouseById.get(line.warehouseId)?.name ?? 'Unavailable warehouse'}
                </small>
              </div>
              <div>
                <span>Available</span>
                <strong>{quantity(line.availableQuantity)}</strong>
              </div>
              <div>
                <span>Minimum</span>
                <strong>{quantity(line.minimumQuantity)}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong>{quantity(line.targetQuantity)}</strong>
              </div>
              <div>
                <span>Recommend</span>
                <strong>{quantity(line.recommendedQuantity)}</strong>
              </div>
            </article>
          ))
        ) : (
          <EmptyInventory
            title="No thresholds configured"
            detail="Set minimum and target quantities to activate recommendations."
          />
        )}
      </section>
    </WarehousePageFrame>
  );
}

function StockSettingsForm({
  accountId,
  onSaved,
  products,
  token,
  warehouses,
}: {
  accountId: string;
  onSaved: () => void;
  products: ProductSummary[];
  token: string;
  warehouses: Warehouse[];
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [minimumQuantity, setMinimumQuantity] = useState('0');
  const [targetQuantity, setTargetQuantity] = useState('0');
  const [notifyCurrentAccount, setNotifyCurrentAccount] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      alertRecipientAccountIds: notifyCurrentAccount ? [accountId] : [],
      minimumQuantity,
      productId,
      targetQuantity,
      warehouseId,
    };
    setSaving(true);
    setError(null);
    try {
      await configureStockSettings(token, attempt(input), input);
      onSaved();
    } catch (caught) {
      setError(commandError(caught, 'Stock settings could not be saved.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="warehouse-command-card" onSubmit={(event) => void submit(event)}>
      <div className="command-card-heading">
        <div>
          <span>Reservation-aware control</span>
          <h2>Minimum and target stock</h2>
        </div>
      </div>
      <div className="warehouse-form-grid four-columns">
        <SelectField
          id="settings-warehouse"
          label="Warehouse"
          onChange={setWarehouseId}
          value={warehouseId}
        >
          {warehouseOptions(warehouses)}
        </SelectField>
        <SelectField
          id="settings-product"
          label="Product"
          onChange={setProductId}
          value={productId}
        >
          {productOptions(products)}
        </SelectField>
        <TextField
          id="minimum-quantity"
          label="Minimum quantity"
          min="0"
          onChange={(event) => setMinimumQuantity(event.target.value)}
          required
          step="0.0001"
          type="number"
          value={minimumQuantity}
        />
        <TextField
          id="target-quantity"
          label="Target quantity"
          min="0"
          onChange={(event) => setTargetQuantity(event.target.value)}
          required
          step="0.0001"
          type="number"
          value={targetQuantity}
        />
      </div>
      <label className="stock-alert-choice">
        <input
          checked={notifyCurrentAccount}
          onChange={(event) => setNotifyCurrentAccount(event.target.checked)}
          type="checkbox"
        />
        <span>
          <strong>Alert me when stock reaches the minimum</strong>
          <small>
            Queues one in-system alert per low-stock cycle; repeated stock changes do not create
            duplicates.
          </small>
        </span>
      </label>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="warehouse-form-actions">
        <Button busy={saving} disabled={!warehouseId || !productId} type="submit">
          Save thresholds
        </Button>
      </div>
    </form>
  );
}

type MovementMode = 'receipt' | 'issue' | 'return' | 'transfer';
const movementTypes: StockMovementType[] = [
  'receipt',
  'issue',
  'return_in',
  'transfer_in',
  'transfer_out',
  'stocktake_in',
  'stocktake_out',
];
function MovementsView({ permissions, products, token, warehouses }: OperationalProps) {
  const [mode, setMode] = useState<MovementMode>('receipt');
  const [journalRevision, setJournalRevision] = useState(0);
  const refreshJournal = useCallback(() => setJournalRevision((value) => value + 1), []);
  return (
    <WarehousePageFrame
      description="Record receipts, issues, linked returns, and transfers with the serial or batch details required for each product."
      eyebrow="ERP · Warehouse"
      title="Stock movements"
    >
      <div className="movement-mode-tabs" role="tablist" aria-label="Movement type">
        {(['receipt', 'issue', 'return', 'transfer'] as const).map((item) => (
          <button
            aria-selected={mode === item}
            className={mode === item ? 'is-active' : undefined}
            key={item}
            onClick={() => setMode(item)}
            role="tab"
            type="button"
          >
            {item === 'receipt'
              ? 'Receive'
              : item === 'issue'
                ? 'Issue'
                : item === 'return'
                  ? 'Return'
                  : 'Transfer'}
          </button>
        ))}
      </div>
      {permissions.create && mode === 'return' ? (
        <ReturnMovementForm onPosted={refreshJournal} token={token} warehouses={warehouses} />
      ) : permissions.create ? (
        <MovementForm
          key={mode}
          mode={mode}
          onPosted={refreshJournal}
          products={products}
          token={token}
          warehouses={warehouses}
        />
      ) : (
        <InlineAlert tone="info">
          Your role can review inventory but cannot post stock movements.
        </InlineAlert>
      )}
      <StockMovementJournal
        revision={journalRevision}
        products={products}
        token={token}
        warehouses={warehouses}
      />
    </WarehousePageFrame>
  );
}

function ReturnMovementForm({
  onPosted,
  token,
  warehouses,
}: {
  onPosted: () => void;
  token: string;
  warehouses: Warehouse[];
}) {
  const [originalIssueId, setOriginalIssueId] = useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [disposition, setDisposition] = useState<ReturnStockRequest['disposition']>('restock');
  const [quantityValue, setQuantityValue] = useState('1');
  const [referenceId, setReferenceId] = useState('');
  const [serialText, setSerialText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    totalCostEur: string;
    unitCostEur: string;
  } | null>(null);
  const attempt = useStableAttempt();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const serialNumbers = parseList(serialText);
    const input: ReturnStockRequest = {
      destinationWarehouseId,
      disposition,
      originalIssueId: originalIssueId.trim(),
      quantity: quantityValue,
      referenceId: referenceId.trim(),
      ...(serialNumbers.length ? { serialNumbers } : {}),
    };
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      setResult(await returnStock(token, attempt(input), input));
      onPosted();
    } catch (caught) {
      setError(commandError(caught, 'The linked stock return could not be posted.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="movement-console" onSubmit={(event) => void submit(event)}>
      <section className="movement-form-main">
        <div className="command-card-heading">
          <div>
            <span>Linked return</span>
            <h2>Restore returned inventory</h2>
          </div>
          <small>The original issue is kept in the movement history.</small>
        </div>
        <InlineAlert tone="info">
          This restores warehouse custody only. Fiscal, invoice, payment, and POS reversal remain
          separate linked workflows.
        </InlineAlert>
        <div className="warehouse-form-grid two-columns">
          <TextField
            id="return-original-issue"
            label="Original issue ID"
            onChange={(event) => setOriginalIssueId(event.target.value)}
            placeholder="Original issue reference"
            required
            value={originalIssueId}
          />
          <SelectField
            id="return-destination"
            label="Destination warehouse"
            onChange={setDestinationWarehouseId}
            value={destinationWarehouseId}
          >
            {warehouseOptions(warehouses)}
          </SelectField>
          <SelectField
            id="return-disposition"
            label="Return disposition"
            onChange={(value) => setDisposition(value as ReturnStockRequest['disposition'])}
            value={disposition}
          >
            <option value="restock">Eligible for stock</option>
            <option value="service">Route for service / repair</option>
          </SelectField>
          <TextField
            id="return-quantity"
            label="Quantity"
            min="0.0001"
            onChange={(event) => setQuantityValue(event.target.value)}
            required
            step="0.0001"
            type="number"
            value={quantityValue}
          />
          <TextField
            id="return-reference"
            label="Return reference"
            maxLength={120}
            onChange={(event) => setReferenceId(event.target.value)}
            placeholder="Return authorization or intake reference"
            required
            value={referenceId}
          />
        </div>
        <TextAreaField
          hint="Required for serial-tracked products. Every serial must belong to the original issue."
          id="return-serials"
          label="Returned serial numbers (when applicable)"
          onChange={setSerialText}
          value={serialText}
        />
        {error ? (
          <InlineAlert tone="error" title="Return not posted">
            {error}
          </InlineAlert>
        ) : null}
        {result ? (
          <InlineAlert tone="success" title="Return posted">
            Return posted; inventory restored at {money(result.unitCostEur)} per unit, total value{' '}
            {money(result.totalCostEur)}.{' '}
            <TechnicalIdentifier kind="stockMovement" value={result.id} />
          </InlineAlert>
        ) : null}
        <div className="warehouse-form-actions">
          <Button
            busy={saving}
            busyLabel="Posting…"
            disabled={!originalIssueId.trim() || !destinationWarehouseId || !referenceId.trim()}
            type="submit"
          >
            Post linked return
          </Button>
        </div>
      </section>
      <aside className="movement-control-rail">
        <span>Return integrity</span>
        <h3>No unlinked stock restoration</h3>
        <p>
          The original issue, product, batch, quantity, and serial numbers are checked before the
          return is saved.
        </p>
        <Link to="/modules/erp.warehouse/reservations">
          Open serial trace <Icon name="arrow" size={14} />
        </Link>
      </aside>
    </form>
  );
}

function MovementForm({
  mode,
  onPosted,
  products,
  token,
  warehouses,
}: {
  mode: MovementMode;
  onPosted: () => void;
  products: ProductSummary[];
  token: string;
  warehouses: Warehouse[];
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [toWarehouseId, setToWarehouseId] = useState(
    warehouses.find((item) => item.id !== warehouses[0]?.id)?.id ?? '',
  );
  const [quantityValue, setQuantityValue] = useState('1');
  const [referenceId, setReferenceId] = useState('');
  const [reason, setReason] = useState<IssueStockRequest['reason']>('sale');
  const [serialText, setSerialText] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [unitCostEur, setUnitCostEur] = useState('0');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    id: string;
    totalCostEur: string;
    unitCostEur: string;
  } | null>(null);
  const attempt = useStableAttempt();
  const product = products.find((item) => item.id === productId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const tracking = trackingInput(product, serialText, batchNumber);
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      if (mode === 'receipt') {
        const input: ReceiveStockRequest = {
          productId,
          quantity: quantityValue,
          referenceId: referenceId.trim(),
          unitCostEur,
          warehouseId,
          ...tracking,
          ...(expiresAt && batchNumber ? { expiresAt } : {}),
        };
        setResult(await receiveStock(token, attempt(input), input));
        onPosted();
      } else if (mode === 'issue') {
        const input: IssueStockRequest = {
          productId,
          quantity: quantityValue,
          reason,
          referenceId: referenceId.trim(),
          warehouseId,
          ...tracking,
        };
        setResult(await issueStock(token, attempt(input), input));
        onPosted();
      } else {
        const input: TransferStockRequest = {
          fromWarehouseId: warehouseId,
          productId,
          quantity: quantityValue,
          referenceId: referenceId.trim(),
          toWarehouseId,
          ...tracking,
        };
        setResult(await transferStock(token, attempt(input), input));
        onPosted();
      }
    } catch (caught) {
      setError(commandError(caught, 'The movement could not be posted.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="movement-console" onSubmit={(event) => void submit(event)}>
      <section className="movement-form-main">
        <div className="command-card-heading">
          <div>
            <span>{mode} stock</span>
            <h2>
              {mode === 'receipt'
                ? 'Receive inventory'
                : mode === 'issue'
                  ? 'Issue inventory'
                  : 'Transfer inventory'}
            </h2>
          </div>
          <small>Each posting creates one traceable stock transaction.</small>
        </div>
        <div className="warehouse-form-grid two-columns">
          <SelectField
            id="movement-product"
            label="Product"
            onChange={setProductId}
            value={productId}
          >
            {productOptions(products)}
          </SelectField>
          <SelectField
            id="movement-warehouse"
            label={mode === 'transfer' ? 'From warehouse' : 'Warehouse'}
            onChange={setWarehouseId}
            value={warehouseId}
          >
            {warehouseOptions(warehouses)}
          </SelectField>
          {mode === 'transfer' ? (
            <SelectField
              id="movement-to-warehouse"
              label="To warehouse"
              onChange={setToWarehouseId}
              value={toWarehouseId}
            >
              {warehouseOptions(warehouses, warehouseId)}
            </SelectField>
          ) : null}
          <TextField
            id="movement-quantity"
            label="Quantity"
            min="0.0001"
            onChange={(event) => setQuantityValue(event.target.value)}
            required
            step="0.0001"
            type="number"
            value={quantityValue}
          />
          <TextField
            id="movement-reference"
            label="Source reference"
            maxLength={120}
            onChange={(event) => setReferenceId(event.target.value)}
            placeholder="Document or work reference"
            required
            value={referenceId}
          />
          {mode === 'receipt' ? (
            <TextField
              id="movement-cost"
              label="Unit cost (EUR)"
              min="0"
              onChange={(event) => setUnitCostEur(event.target.value)}
              required
              step="0.0001"
              type="number"
              value={unitCostEur}
            />
          ) : null}
          {mode === 'issue' ? (
            <SelectField
              id="movement-reason"
              label="Issue reason"
              onChange={(value) => setReason(value as IssueStockRequest['reason'])}
              value={reason}
            >
              <option value="sale">Sale</option>
              <option value="repair">Repair use</option>
              <option value="writeoff">Write-off</option>
            </SelectField>
          ) : null}
        </div>
        {product?.trackingMode === 'serial' ? (
          <TextAreaField
            id="movement-serials"
            label="Serial numbers"
            hint="One per line or comma separated. The count must equal the quantity."
            onChange={setSerialText}
            required
            value={serialText}
          />
        ) : null}
        {product?.trackingMode === 'batch' ? (
          <div className="warehouse-form-grid two-columns">
            <TextField
              id="movement-batch"
              label="Batch number"
              maxLength={100}
              onChange={(event) => setBatchNumber(event.target.value)}
              required
              value={batchNumber}
            />
            {mode === 'receipt' ? (
              <TextField
                id="movement-expiry"
                label="Expiration date (when applicable)"
                onChange={(event) => setExpiresAt(event.target.value)}
                type="date"
                value={expiresAt}
              />
            ) : null}
          </div>
        ) : null}
        {error ? (
          <InlineAlert tone="error" title="Movement not posted">
            {error}
          </InlineAlert>
        ) : null}
        {result ? (
          <InlineAlert tone="success" title="Movement posted">
            Movement posted at {money(result.unitCostEur)} per unit; total value{' '}
            {money(result.totalCostEur)}.{' '}
            <TechnicalIdentifier kind="stockMovement" value={result.id} />
          </InlineAlert>
        ) : null}
        <div className="warehouse-form-actions">
          <Button
            busy={saving}
            busyLabel="Posting…"
            disabled={
              !productId ||
              !warehouseId ||
              !referenceId.trim() ||
              (mode === 'transfer' && !toWarehouseId)
            }
            type="submit"
          >
            Post {mode}
          </Button>
        </div>
      </section>
      <aside className="movement-control-rail">
        <span>Posting control</span>
        <h3>
          {product?.trackingMode === 'serial'
            ? 'Serial identity required'
            : product?.trackingMode === 'batch'
              ? 'Batch details required'
              : 'Quantity required'}
        </h3>
        <p>
          Availability, open stock counts, reservations, serials, batches, and negative stock are
          checked before posting.
        </p>
        <Link to="/modules/erp.warehouse/stock">
          Review stock <Icon name="arrow" size={14} />
        </Link>
      </aside>
    </form>
  );
}

function StockMovementJournal({
  products,
  revision,
  token,
  warehouses,
}: {
  products: ProductSummary[];
  revision: number;
  token: string;
  warehouses: Warehouse[];
}) {
  const { dateLocale } = useLocalization();
  const [warehouseId, setWarehouseId] = useState('');
  const [productId, setProductId] = useState('');
  const [movementType, setMovementType] = useState<StockMovementType | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState<StockMovementJournalQuery>({ page: 1, pageSize: 25 });
  const [data, setData] = useState<StockMovementJournalPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void listStockMovements(token, query)
      .then((next) => {
        if (active) setData(next);
      })
      .catch((caught: unknown) => {
        if (active) setError(commandError(caught, 'Movement history could not be loaded.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, refresh, revision, token]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setQuery({
      page: 1,
      pageSize: 25,
      ...(movementType ? { movementType } : {}),
      ...(productId ? { productId } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(warehouseId ? { warehouseId } : {}),
    });
  }

  return (
    <section aria-label="Posted stock movements" className="inventory-panel stock-movement-journal">
      <header className="inventory-panel-heading">
        <div>
          <span>Movement history</span>
          <h2>Posted stock movements</h2>
          <small>
            Review stock changes and open the linked source record when one is available.
          </small>
        </div>
        <Button onClick={() => setRefresh((value) => value + 1)} type="button" variant="secondary">
          Refresh
        </Button>
      </header>

      <form className="movement-journal-filters" onSubmit={applyFilters}>
        <SelectField
          id="journal-warehouse"
          label="Warehouse"
          onChange={setWarehouseId}
          value={warehouseId}
        >
          <option value="">All warehouses</option>
          {warehouses.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <SelectField id="journal-product" label="Product" onChange={setProductId} value={productId}>
          <option value="">All products</option>
          {products.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.productCode}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="journal-movement-type"
          label="Movement"
          onChange={(value) => setMovementType(value as StockMovementType | '')}
          value={movementType}
        >
          <option value="">All movements</option>
          {movementTypes.map((type) => (
            <option key={type} value={type}>
              {movementTypeLabel(type)}
            </option>
          ))}
        </SelectField>
        <TextField
          id="journal-search"
          label="Search product or reference"
          maxLength={120}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, product code, or document reference"
          value={search}
        />
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
      </form>

      {error ? (
        <InlineAlert tone="error" title="Movement history unavailable">
          {error}
        </InlineAlert>
      ) : null}
      {loading ? <p className="movement-journal-state">Loading movement history…</p> : null}
      {!loading && !error && data?.items.length === 0 ? (
        <p className="movement-journal-state">No posted movements match these filters.</p>
      ) : null}
      {!loading && !error && data?.items.length ? (
        <>
          <div className="movement-journal-scroll">
            <table className="movement-journal-table">
              <thead>
                <tr>
                  <th scope="col">Date and time</th>
                  <th scope="col">Movement</th>
                  <th scope="col">Product</th>
                  <th scope="col">Warehouse</th>
                  <th scope="col">Source record</th>
                  <th className="is-numeric" scope="col">
                    Quantity
                  </th>
                  <th className="is-numeric" scope="col">
                    Value
                  </th>
                  <th scope="col">Posted by</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatMovementDate(item.occurredAt, dateLocale)}</td>
                    <td>
                      <span className={`movement-journal-type is-${item.movementType}`}>
                        {movementTypeLabel(item.movementType)}
                      </span>
                    </td>
                    <td>
                      <strong>{item.productName}</strong>
                      <small>{item.productCode}</small>
                    </td>
                    <td>{item.warehouseName}</td>
                    <td>
                      {item.sourceHref ? (
                        <Link className="movement-source-link" to={item.sourceHref}>
                          {item.referenceLabel}
                        </Link>
                      ) : (
                        <span>{item.referenceLabel}</span>
                      )}
                      <small>{item.referenceType}</small>
                    </td>
                    <td
                      className={`is-numeric ${Number(item.quantity) < 0 ? 'is-negative' : 'is-positive'}`}
                    >
                      {formatMovementQuantity(item.quantity, dateLocale)}
                    </td>
                    <td className="is-numeric">
                      <strong>{money(item.totalCostEur)}</strong>
                      <small>{money(item.unitCostEur)} / unit</small>
                    </td>
                    <td>{item.actorDisplayName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="movement-journal-pagination">
            <span>{data.total.toLocaleString(dateLocale)} movements</span>
            <div>
              <Button
                disabled={data.page <= 1 || loading}
                onClick={() => setQuery((current) => ({ ...current, page: data.page - 1 }))}
                type="button"
                variant="secondary"
              >
                Previous
              </Button>
              <span>
                Page {data.page} of {Math.max(data.totalPages, 1)}
              </span>
              <Button
                disabled={data.page >= data.totalPages || loading}
                onClick={() => setQuery((current) => ({ ...current, page: data.page + 1 }))}
                type="button"
                variant="secondary"
              >
                Next
              </Button>
            </div>
          </footer>
        </>
      ) : null}
    </section>
  );
}

function StocktakesView({ permissions, products, token, warehouses }: OperationalProps) {
  const [session, setSession] = useState<Stocktake | null>(null);
  const [countedProducts, setCountedProducts] = useState<string[]>([]);
  return (
    <WarehousePageFrame
      description="Pause warehouse movements, record the physical count, and submit differences for approval."
      eyebrow="ERP · Count and approval"
      title="Stocktakes"
    >
      {!permissions.create ? (
        <InlineAlert tone="info">
          Your role can view this workflow but cannot open or count a stocktake.
        </InlineAlert>
      ) : session ? (
        <StocktakeSession
          canApprove={permissions.approve}
          countedProducts={countedProducts}
          onCompleted={setSession}
          onCounted={(productId) =>
            setCountedProducts((current) =>
              current.includes(productId) ? current : [...current, productId],
            )
          }
          products={products}
          session={session}
          token={token}
          warehouses={warehouses}
        />
      ) : (
        <OpenStocktakeForm onOpened={setSession} token={token} warehouses={warehouses} />
      )}
    </WarehousePageFrame>
  );
}

function OpenStocktakeForm({
  onOpened,
  token,
  warehouses,
}: {
  onOpened: (stocktake: Stocktake) => void;
  token: string;
  warehouses: Warehouse[];
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [referenceId, setReferenceId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { referenceId: referenceId.trim(), warehouseId };
    setSaving(true);
    setError(null);
    try {
      onOpened(await openStocktake(token, attempt(input), input));
    } catch (caught) {
      setError(commandError(caught, 'The stocktake could not be opened.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="warehouse-command-card stocktake-open"
      onSubmit={(event) => void submit(event)}
    >
      <div className="command-card-heading">
        <div>
          <span>Step 1 of 3</span>
          <h2>Start a stock count</h2>
        </div>
        <small>Posting is frozen for the selected warehouse until completion.</small>
      </div>
      <div className="warehouse-form-grid two-columns">
        <SelectField
          id="stocktake-warehouse"
          label="Warehouse"
          onChange={setWarehouseId}
          value={warehouseId}
        >
          {warehouseOptions(warehouses)}
        </SelectField>
        <TextField
          id="stocktake-reference"
          label="Count reference"
          maxLength={120}
          onChange={(event) => setReferenceId(event.target.value)}
          placeholder="e.g. ST-2026-08-CENTRAL"
          required
          value={referenceId}
        />
      </div>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="warehouse-form-actions">
        <Button busy={saving} disabled={!warehouseId || !referenceId.trim()} type="submit">
          Open stocktake
        </Button>
      </div>
    </form>
  );
}

function StocktakeSession({
  canApprove,
  countedProducts,
  onCompleted,
  onCounted,
  products,
  session,
  token,
  warehouses,
}: {
  canApprove: boolean;
  countedProducts: string[];
  onCompleted: (value: Stocktake) => void;
  onCounted: (id: string) => void;
  products: ProductSummary[];
  session: Stocktake;
  token: string;
  warehouses: Warehouse[];
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [countedQuantity, setCountedQuantity] = useState('0');
  const [serialText, setSerialText] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countAttempt = useStableAttempt();
  const completeAttempt = useStableAttempt();
  const product = products.find((item) => item.id === productId);
  async function count(event: FormEvent) {
    event.preventDefault();
    const input = {
      countedQuantity,
      productId,
      ...(product?.trackingMode === 'serial' ? { serialNumbers: parseList(serialText) } : {}),
      ...(product?.trackingMode === 'batch'
        ? {
            batches: [
              {
                batchNumber: batchNumber.trim(),
                countedQuantity,
                ...(expiresAt ? { expiresAt } : {}),
              },
            ],
          }
        : {}),
    };
    setSaving(true);
    setError(null);
    try {
      await recordStocktakeCount(token, countAttempt(input), session.id, input);
      onCounted(productId);
      setSerialText('');
      setBatchNumber('');
    } catch (caught) {
      setError(commandError(caught, 'The count could not be recorded.'));
    } finally {
      setSaving(false);
    }
  }
  async function finish() {
    setCompleting(true);
    setError(null);
    try {
      onCompleted(await completeStocktake(token, completeAttempt({ id: session.id }), session.id));
    } catch (caught) {
      setError(commandError(caught, 'The stocktake could not be completed.'));
    } finally {
      setCompleting(false);
    }
  }
  return (
    <div className="stocktake-session">
      <section className="stocktake-session-banner">
        <div>
          <span>Open count</span>
          <h2>{session.referenceId}</h2>
          <p>
            {warehouses.find((item) => item.id === session.warehouseId)?.name ??
              session.warehouseId}
          </p>
        </div>
        <div>
          <strong>{countedProducts.length}</strong>
          <span>products counted</span>
        </div>
      </section>
      {session.status === 'completed' ? (
        <InlineAlert tone="success" title="Stocktake completed">
          Approved adjustments were posted and normal warehouse movement processing can resume.
        </InlineAlert>
      ) : (
        <form className="warehouse-command-card" onSubmit={(event) => void count(event)}>
          <div className="command-card-heading">
            <div>
              <span>Step 2 of 3</span>
              <h2>Record counted stock</h2>
            </div>
          </div>
          <div className="warehouse-form-grid two-columns">
            <SelectField
              id="count-product"
              label="Product"
              onChange={setProductId}
              value={productId}
            >
              {productOptions(products)}
            </SelectField>
            <TextField
              id="count-quantity"
              label="Counted quantity"
              min="0"
              onChange={(event) => setCountedQuantity(event.target.value)}
              required
              step="0.0001"
              type="number"
              value={countedQuantity}
            />
          </div>
          {product?.trackingMode === 'serial' ? (
            <TextAreaField
              id="count-serials"
              label="Observed serial numbers"
              onChange={setSerialText}
              required
              value={serialText}
            />
          ) : null}
          {product?.trackingMode === 'batch' ? (
            <div className="warehouse-form-grid two-columns">
              <TextField
                id="count-batch"
                label="Observed batch"
                onChange={(event) => setBatchNumber(event.target.value)}
                required
                value={batchNumber}
              />
              <TextField
                id="count-expiry"
                label="Expiration date (when applicable)"
                onChange={(event) => setExpiresAt(event.target.value)}
                type="date"
                value={expiresAt}
              />
            </div>
          ) : null}
          {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          <div className="warehouse-form-actions split">
            <Button busy={saving} disabled={!productId} type="submit">
              Record product count
            </Button>
            {canApprove ? (
              <Button
                busy={completing}
                disabled={!countedProducts.length}
                onClick={() => void finish()}
                variant="secondary"
              >
                Approve & complete
              </Button>
            ) : (
              <span className="approval-note">
                Completion requires warehouse approval permission.
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function ReservationsView(props: OperationalProps) {
  const { permissions, products, token, warehouses } = props;
  const [reservation, setReservation] = useState<StockReservation | null>(null);
  const [reservationPage, setReservationPage] = useState<StockReservationPage | null>(null);
  const [reservationPageNumber, setReservationPageNumber] = useState(1);
  const [reservationLoading, setReservationLoading] = useState(true);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [reservationReload, setReservationReload] = useState(0);
  useEffect(() => {
    let current = true;
    setReservationLoading(true);
    setReservationError(null);
    void listStockReservations(token, { page: reservationPageNumber, pageSize: 25 })
      .then((result) => {
        if (current) setReservationPage(result);
      })
      .catch((caught: unknown) => {
        if (current)
          setReservationError(commandError(caught, 'Active reservations could not be loaded.'));
      })
      .finally(() => {
        if (current) setReservationLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reservationPageNumber, reservationReload, token]);
  function refreshReservations(value: StockReservation) {
    setReservation(value);
    setReservationReload((current) => current + 1);
  }
  return (
    <WarehousePageFrame
      description="Reserve quantities or exact serial numbers for a sales order, quotation, or service request, and review device movements."
      eyebrow="ERP · Commitment and trace"
      title="Reservations & serial trace"
    >
      <div className="reservation-trace-grid">
        <section>
          {permissions.create ? (
            <ReservationForm
              onCreated={refreshReservations}
              products={products}
              token={token}
              warehouses={warehouses}
            />
          ) : (
            <InlineAlert tone="info">Your role cannot create stock reservations.</InlineAlert>
          )}
          {reservation ? (
            <InlineAlert tone="success">
              Reservation for <strong>{reservation.referenceLabel}</strong> is now{' '}
              <strong>{reservation.status}</strong>.
            </InlineAlert>
          ) : null}
          <section className="warehouse-command-card reservation-register">
            <div className="command-card-heading">
              <div>
                <span>Warehouse commitments</span>
                <h2>Active reservations</h2>
              </div>
              <small>{reservationPage?.total ?? 0} active</small>
            </div>
            {reservationLoading ? <p role="status">Loading reservations…</p> : null}
            {reservationError ? <InlineAlert tone="error">{reservationError}</InlineAlert> : null}
            {!reservationLoading && !reservationError && !reservationPage?.items.length ? (
              <p>No active reservations.</p>
            ) : null}
            {reservationPage?.items.map((item) => (
              <ReservationReceipt
                key={item.id}
                canRelease={permissions.edit}
                onChanged={refreshReservations}
                products={products}
                reservation={item}
                token={token}
                warehouses={warehouses}
              />
            ))}
            {reservationPage && reservationPage.totalPages > 1 ? (
              <div className="reservation-pagination">
                <Button
                  disabled={reservationPageNumber <= 1}
                  onClick={() => setReservationPageNumber((current) => current - 1)}
                  variant="secondary"
                >
                  Previous
                </Button>
                <span>
                  Page {reservationPage.page} of {reservationPage.totalPages}
                </span>
                <Button
                  disabled={reservationPageNumber >= reservationPage.totalPages}
                  onClick={() => setReservationPageNumber((current) => current + 1)}
                  variant="secondary"
                >
                  Next
                </Button>
              </div>
            ) : null}
          </section>
        </section>
        <section className="embedded-trace">
          <SerialTraceabilityPage compact />
        </section>
      </div>
    </WarehousePageFrame>
  );
}

function ReservationForm({
  onCreated,
  products,
  token,
  warehouses,
}: {
  onCreated: (value: StockReservation) => void;
  products: ProductSummary[];
  token: string;
  warehouses: Warehouse[];
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [quantityValue, setQuantityValue] = useState('1');
  const [referenceType, setReferenceType] =
    useState<CreateStockReservationRequest['referenceType']>('sales_order');
  const [referenceId, setReferenceId] = useState('');
  const [serialText, setSerialText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();
  const product = products.find((item) => item.id === productId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input: CreateStockReservationRequest = {
      productId,
      quantity: quantityValue,
      referenceId: referenceId.trim(),
      referenceType,
      warehouseId,
      ...(product?.trackingMode === 'serial' ? { serialNumbers: parseList(serialText) } : {}),
    };
    setSaving(true);
    setError(null);
    try {
      onCreated(await createStockReservation(token, attempt(input), input));
    } catch (caught) {
      setError(commandError(caught, 'The reservation could not be created.'));
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="warehouse-command-card reservation-form"
      onSubmit={(event) => void submit(event)}
    >
      <div className="command-card-heading">
        <div>
          <span>New commitment</span>
          <h2>Reserve stock</h2>
        </div>
        <small>Availability is checked when the reservation is saved.</small>
      </div>
      <div className="warehouse-form-grid two-columns">
        <SelectField
          id="reservation-warehouse"
          label="Warehouse"
          onChange={setWarehouseId}
          value={warehouseId}
        >
          {warehouseOptions(warehouses)}
        </SelectField>
        <SelectField
          id="reservation-product"
          label="Product"
          onChange={setProductId}
          value={productId}
        >
          {productOptions(products)}
        </SelectField>
        <SelectField
          id="reservation-reference-type"
          label="Reference type"
          onChange={(value) =>
            setReferenceType(value as CreateStockReservationRequest['referenceType'])
          }
          value={referenceType}
        >
          <option value="sales_order">Sales order</option>
          <option value="quotation">Quotation</option>
          <option value="service_request">Service request</option>
        </SelectField>
        <TextField
          id="reservation-reference"
          label="Reference"
          maxLength={120}
          hint="Enter an existing order, quotation, or service request number."
          onChange={(event) => setReferenceId(event.target.value)}
          required
          value={referenceId}
        />
        <TextField
          id="reservation-quantity"
          label="Quantity"
          min="0.0001"
          onChange={(event) => setQuantityValue(event.target.value)}
          required
          step="0.0001"
          type="number"
          value={quantityValue}
        />
      </div>
      {product?.trackingMode === 'serial' ? (
        <TextAreaField
          id="reservation-serials"
          label="Specific serial numbers"
          hint="Required for serial-tracked products."
          onChange={setSerialText}
          required
          value={serialText}
        />
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      <div className="warehouse-form-actions">
        <Button
          busy={saving}
          disabled={!productId || !warehouseId || !referenceId.trim()}
          type="submit"
        >
          Create reservation
        </Button>
      </div>
    </form>
  );
}

function ReservationReceipt({
  canRelease,
  onChanged,
  products,
  reservation,
  token,
  warehouses,
}: {
  canRelease: boolean;
  onChanged: (value: StockReservation) => void;
  products: ProductSummary[];
  reservation: StockReservation;
  token: string;
  warehouses: Warehouse[];
}) {
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useStableAttempt();
  async function release() {
    setReleasing(true);
    setError(null);
    try {
      onChanged(
        await releaseStockReservation(token, attempt({ id: reservation.id }), reservation.id),
      );
    } catch (caught) {
      setError(commandError(caught, 'The reservation could not be released.'));
    } finally {
      setReleasing(false);
    }
  }
  return (
    <article className="reservation-receipt">
      <div>
        <span className={`reservation-status status-${reservation.status}`}>
          {reservation.status}
        </span>
        <strong>
          {products.find((item) => item.id === reservation.productId)?.name ??
            reservation.productId}
        </strong>
        <small>
          {warehouses.find((item) => item.id === reservation.warehouseId)?.name ??
            reservation.warehouseId}
        </small>
      </div>
      <div>
        <span>Reference</span>
        <strong>{reservation.referenceLabel}</strong>
        <small>{reservation.referenceType.replace('_', ' ')}</small>
      </div>
      <div>
        <span>Remaining</span>
        <strong>
          {quantity(reservation.remainingQuantity)} / {quantity(reservation.initialQuantity)}
        </strong>
      </div>
      {canRelease && reservation.status === 'active' ? (
        <Button busy={releasing} onClick={() => void release()} variant="quiet">
          Release
        </Button>
      ) : null}
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </article>
  );
}

function WarehousePageFrame({
  action,
  children,
  description,
  eyebrow,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="page-stack warehouse-operations-page">
      <header className="page-header warehouse-page-header">
        <div>
          <p className="page-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {action}
      </header>
      <nav className="warehouse-subnav" aria-label="Warehouse operations">
        <Link to="/modules/erp.warehouse/warehouses">Warehouses</Link>
        <Link to="/modules/erp.warehouse/stock">Stock</Link>
        <Link to="/modules/erp.warehouse/movements">Movements</Link>
        <Link to="/modules/erp.warehouse/stocktakes">Stocktakes</Link>
        <Link to="/modules/erp.warehouse/reservations">Reservations & trace</Link>
        <Link to="/modules/erp.warehouse/reports">{erpReportMessages.title}</Link>
      </nav>
      {children}
    </div>
  );
}

function SelectField({
  children,
  id,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="vista-field">
      <label htmlFor={id}>{label}</label>
      <div className="vista-field-control">
        <select
          className="vista-field-input"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {children}
        </select>
      </div>
    </div>
  );
}
function TextAreaField({
  hint,
  id,
  label,
  onChange,
  required,
  value,
}: {
  hint?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  value: string;
}) {
  return (
    <div className="vista-field">
      <label htmlFor={id}>{label}</label>
      <div className="vista-field-control">
        <textarea
          className="vista-field-input warehouse-textarea"
          id={id}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          rows={4}
          value={value}
        />
      </div>
      {hint ? <p className="vista-field-message">{hint}</p> : null}
    </div>
  );
}
function Metric({
  detail,
  label,
  tone = 'neutral',
  value,
}: {
  detail: string;
  label: string;
  tone?: 'neutral' | 'positive' | 'warning';
  value: string;
}) {
  return (
    <article className={`inventory-metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function EmptyInventory({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="inventory-empty">
      <Icon name="warehouse" size={20} />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function WarehouseLoading() {
  return (
    <div className="warehouse-loading" aria-label="Loading warehouse operations">
      <div />
      <div />
      <div />
    </div>
  );
}
function WarehouseState({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="catalog-state warehouse-state">
      <span>
        <Icon name="warehouse" size={22} />
      </span>
      <h1>{title}</h1>
      <div>{children}</div>
    </section>
  );
}
function warehouseOptions(warehouses: Warehouse[], omitId?: string) {
  return warehouses
    .filter((item) => item.id !== omitId)
    .map((item) => (
      <option key={item.id} value={item.id}>
        {item.name} · {item.code}
      </option>
    ));
}
function productOptions(products: ProductSummary[]) {
  return products.map((item) => (
    <option key={item.id} value={item.id}>
      {item.name} · {item.productCode}
    </option>
  ));
}
function parseList(value: string) {
  return value
    .split(/[\n,]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}
function trackingInput(
  product: ProductSummary | undefined,
  serialText: string,
  batchNumber: string,
) {
  if (product?.trackingMode === 'serial') return { serialNumbers: parseList(serialText) };
  if (product?.trackingMode === 'batch') return { batchNumber: batchNumber.trim() };
  return {};
}
function useStableAttempt() {
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  return (input: unknown) => {
    const fingerprint = JSON.stringify(input);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    return attempt.current.key;
  };
}
function commandError(caught: unknown, fallback: string) {
  if (!(caught instanceof ApiClientError)) return fallback;
  const details = caught.details.map((detail) => detail.message.trim()).filter(Boolean);
  return details.length ? `${caught.message}: ${details.join('. ')}` : caught.message;
}
function quantity(value: string | number) {
  return formatOperationsNumber(Number(value), { maximumFractionDigits: 4 });
}
function money(value: string | number) {
  return formatOperationsCurrency(value, 'EUR');
}
function displayedEurMinorUnits(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return 0n;
  let minor = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0').slice(0, 2));
  if ((match[3] ?? '')[2] && (match[3] ?? '')[2]! >= '5') minor += 1n;
  return match[1] === '-' ? -minor : minor;
}
function moneyFromEurMinorUnits(value: bigint) {
  return formatOperationsMinorCurrency(value, 'EUR');
}
function formatMovementDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/Sofia',
      }).format(date);
}
function formatMovementQuantity(value: string, locale: string) {
  const quantity = Number(value);
  const formatted = Math.abs(quantity).toLocaleString(locale, { maximumFractionDigits: 4 });
  return quantity < 0 ? `−${formatted}` : `+${formatted}`;
}
function movementTypeLabel(type: StockMovementType) {
  const labels: Record<StockMovementType, string> = {
    issue: 'Issued',
    receipt: 'Received',
    return_in: 'Return received',
    stocktake_in: 'Stocktake increase',
    stocktake_out: 'Stocktake decrease',
    transfer_in: 'Transfer in',
    transfer_out: 'Transfer out',
  };
  return labels[type];
}
import { erpReportMessages } from './erp-report.messages';
