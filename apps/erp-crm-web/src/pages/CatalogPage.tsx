import { Button, InlineAlert, TextField, Toast } from '@vista/ui';
import type {
  CreateProductRequest,
  CreateUnitRequest,
  ProductBarcode,
  ProductCategory,
  ProductSummary,
  Unit,
} from '@vista/contracts';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { createProduct, createUnit, listProducts, listUnits } from '../api/catalog';
import { listProductCategories } from '../api/product-categories';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { Link } from '../routing/Router';

type CatalogTab = 'products' | 'units';

export function CatalogPage() {
  const { hasPermission, session } = useAuth();
  const [tab, setTab] = useState<CatalogTab>('products');
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [categories, setCategories] = useState<ProductCategory[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [drawer, setDrawer] = useState<CatalogTab | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const token = session?.sessionToken;
  const canCreate = hasPermission('erp.warehouse', 'create');

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    void Promise.all([listProducts(token), listUnits(token), listProductCategories(token)])
      .then(([nextProducts, nextUnits, nextCategories]) => {
        if (!active) return;
        setProducts(nextProducts);
        setUnits(nextUnits);
        setCategories(nextCategories);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, token]);

  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  );
  const unitById = useMemo(() => new Map((units ?? []).map((unit) => [unit.id, unit])), [units]);
  const productPrerequisitesReady = (categories?.length ?? 0) > 0 && (units?.length ?? 0) > 0;

  function openCreateDrawer() {
    if (tab === 'products' && !productPrerequisitesReady) {
      setNotice('Create at least one category and one unit before adding a product.');
      return;
    }
    setDrawer(tab);
  }

  return (
    <div className="page-stack catalog-page">
      <header className="page-header catalog-header">
        <div>
          <p className="page-eyebrow">ERP · Warehouse</p>
          <h1>Product catalog</h1>
          <p>
            Maintain reusable product identity, barcodes, and units. Inventory, pricing, serials,
            batches, and stock movements are managed separately.
          </p>
        </div>
        {canCreate ? (
          <Button onClick={openCreateDrawer}>Add {tab === 'products' ? 'product' : 'unit'}</Button>
        ) : null}
      </header>

      {notice ? (
        <Toast onDismiss={() => setNotice(null)} tone="success">
          {notice}
        </Toast>
      ) : null}

      <section className="catalog-context-strip">
        <div>
          <span>Category policy</span>
          <strong>Controls serial, batch, and expiry rules</strong>
        </div>
        <div>
          <span>Product identity</span>
          <strong>Code and barcode are unique across the catalog</strong>
        </div>
        <Link to="/catalog/categories">
          Configure categories <Icon name="arrow" size={15} />
        </Link>
      </section>

      <div className="catalog-tabs" role="tablist" aria-label="Catalog data">
        <button
          aria-selected={tab === 'products'}
          className={tab === 'products' ? 'is-active' : undefined}
          onClick={() => setTab('products')}
          role="tab"
          type="button"
        >
          Products <span>{products?.length ?? '—'}</span>
        </button>
        <button
          aria-selected={tab === 'units'}
          className={tab === 'units' ? 'is-active' : undefined}
          onClick={() => setTab('units')}
          role="tab"
          type="button"
        >
          Units <span>{units?.length ?? '—'}</span>
        </button>
      </div>

      {loading ? <CatalogSkeleton /> : null}
      {loadError ? (
        <CatalogState title="The catalog could not be loaded.">
          <Button onClick={() => setRefresh((value) => value + 1)} variant="secondary">
            Try again
          </Button>
        </CatalogState>
      ) : null}
      {!loading && !loadError && tab === 'products' ? (
        <ProductsPanel
          canCreate={canCreate}
          categoryById={categoryById}
          onCreate={() => {
            if (!productPrerequisitesReady) {
              setNotice('Create at least one category and one unit before adding a product.');
              return;
            }
            setDrawer('products');
          }}
          productPrerequisitesReady={productPrerequisitesReady}
          products={products ?? []}
          unitById={unitById}
        />
      ) : null}
      {!loading && !loadError && tab === 'units' ? (
        <UnitsPanel canCreate={canCreate} onCreate={() => setDrawer('units')} units={units ?? []} />
      ) : null}

      {drawer === 'units' && token ? (
        <UnitDrawer
          onClose={() => setDrawer(null)}
          onCreated={() => {
            setDrawer(null);
            setNotice('Unit added to the shared catalog.');
            setRefresh((value) => value + 1);
          }}
          token={token}
        />
      ) : null}
      {drawer === 'products' && token && units && categories ? (
        <ProductDrawer
          categories={categories}
          onClose={() => setDrawer(null)}
          onCreated={() => {
            setDrawer(null);
            setNotice('Product added to the shared catalog.');
            setRefresh((value) => value + 1);
          }}
          token={token}
          units={units}
        />
      ) : null}
    </div>
  );
}

function ProductsPanel({
  canCreate,
  categoryById,
  onCreate,
  productPrerequisitesReady,
  products,
  unitById,
}: {
  canCreate: boolean;
  categoryById: Map<string, ProductCategory>;
  onCreate: () => void;
  productPrerequisitesReady: boolean;
  products: ProductSummary[];
  unitById: Map<string, Unit>;
}) {
  if (products.length === 0)
    return (
      <CatalogState title="No products configured">
        <p>Add the first product with its code, category, unit, and any known barcode.</p>
        {canCreate && productPrerequisitesReady ? (
          <Button onClick={onCreate} variant="secondary">
            Add the first product
          </Button>
        ) : canCreate ? (
          <InlineAlert tone="info">
            Add a category and a unit first; products cannot exist without both references.
          </InlineAlert>
        ) : null}
      </CatalogState>
    );
  return (
    <section className="catalog-list" aria-label="Products">
      <div className="catalog-list-head">
        <span>Product</span>
        <span>Category & tracking</span>
        <span>Unit</span>
        <span>Barcodes</span>
      </div>
      {products.map((product) => (
        <article className="catalog-product-row" key={product.id}>
          <div>
            <strong>{product.name}</strong>
            <small>{product.productCode}</small>
          </div>
          <div>
            <span>{categoryById.get(product.categoryId)?.name ?? 'Unavailable category'}</span>
            <small className={`tracking-chip tracking-${product.trackingMode}`}>
              {trackingLabel(product.trackingMode)}
            </small>
          </div>
          <div>{unitById.get(product.unitId)?.code ?? 'Unavailable unit'}</div>
          <BarcodeList barcodes={product.barcodes} />
        </article>
      ))}
    </section>
  );
}

function UnitsPanel({
  canCreate,
  onCreate,
  units,
}: {
  canCreate: boolean;
  onCreate: () => void;
  units: Unit[];
}) {
  if (units.length === 0)
    return (
      <CatalogState title="No units configured">
        <p>
          Add the units your team uses for product quantities. Existing product history is kept when
          a unit name changes.
        </p>
        {canCreate ? (
          <Button onClick={onCreate} variant="secondary">
            Add the first unit
          </Button>
        ) : null}
      </CatalogState>
    );
  return (
    <section className="catalog-list catalog-units-list" aria-label="Units">
      <div className="catalog-list-head">
        <span>Code</span>
        <span>Unit name</span>
        <span>Status</span>
      </div>
      {units.map((unit) => (
        <article className="catalog-unit-row" key={unit.id}>
          <strong>{unit.code}</strong>
          <span>{unit.name}</span>
          <small>Active</small>
        </article>
      ))}
    </section>
  );
}

function BarcodeList({ barcodes }: { barcodes: ProductBarcode[] }) {
  return (
    <div className="barcode-list">
      {barcodes.length ? (
        barcodes.map((barcode) => (
          <span key={barcode.id}>
            {barcode.barcode}
            <small>{barcode.barcodeType}</small>
          </span>
        ))
      ) : (
        <small>No barcode</small>
      )}
    </div>
  );
}
function CatalogState({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="catalog-state">
      <span>
        <Icon name="warehouse" size={22} />
      </span>
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
function CatalogSkeleton() {
  return (
    <section className="catalog-list catalog-skeleton" aria-label="Loading catalog">
      <div />
      <div />
      <div />
    </section>
  );
}

function UnitDrawer({
  onClose,
  onCreated,
  token,
}: {
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateUnitRequest = { code: code.trim(), name: name.trim() };
    if (!input.code || !input.name) return;
    const fingerprint = JSON.stringify(input);
    const nextAttempt =
      attempt.current?.fingerprint === fingerprint
        ? attempt.current
        : { fingerprint, key: crypto.randomUUID() };
    attempt.current = nextAttempt;
    setSaving(true);
    setError(null);
    try {
      await createUnit(token, nextAttempt.key, input);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError('The unit could not be saved.', 'UNKNOWN', 0),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <CatalogDrawer onClose={onClose} title="Add unit">
      <p>
        Use a concise code and the business-facing unit name. Codes are normalized to uppercase.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <TextField
          autoFocus
          id="unit-code"
          label="Unit code"
          maxLength={30}
          onChange={(event) => setCode(event.target.value)}
          required
          value={code}
        />
        <TextField
          id="unit-name"
          label="Unit name"
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        {error ? (
          <InlineAlert tone="error" title="Unit not saved">
            {error.message}
          </InlineAlert>
        ) : null}
        <DrawerActions onClose={onClose} saving={saving} submit="Add unit" />
      </form>
    </CatalogDrawer>
  );
}

function ProductDrawer({
  categories,
  onClose,
  onCreated,
  token,
  units,
}: {
  categories: ProductCategory[];
  onClose: () => void;
  onCreated: () => void;
  token: string;
  units: Unit[];
}) {
  const [name, setName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [unitId, setUnitId] = useState(units[0]?.id ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState('24');
  const [barcodes, setBarcodes] = useState([{ barcode: '', barcodeType: 'other' as const }]);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const selectedCategory = categories.find((category) => category.id === categoryId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateProductRequest = {
      categoryId,
      name: name.trim(),
      productCode: productCode.trim(),
      unitId,
      ...(selectedCategory?.trackingMode === 'serial' && warrantyMonths
        ? { warrantyMonths: Number(warrantyMonths) }
        : {}),
      ...(barcodes.some((barcode) => barcode.barcode.trim())
        ? { barcodes: barcodes.filter((barcode) => barcode.barcode.trim()) }
        : {}),
    };
    if (!input.name || !input.productCode || !input.categoryId || !input.unitId) return;
    const fingerprint = JSON.stringify(input);
    const nextAttempt =
      attempt.current?.fingerprint === fingerprint
        ? attempt.current
        : { fingerprint, key: crypto.randomUUID() };
    attempt.current = nextAttempt;
    setSaving(true);
    setError(null);
    try {
      await createProduct(token, nextAttempt.key, input);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError('The product could not be saved.', 'UNKNOWN', 0),
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <CatalogDrawer onClose={onClose} title="Add product">
      <p>
        Product code is normalized to uppercase. The selected category determines whether later
        inventory needs serial or batch tracking.
      </p>
      <form onSubmit={(event) => void submit(event)}>
        <TextField
          autoFocus
          id="product-code"
          label="Product code"
          maxLength={80}
          onChange={(event) => setProductCode(event.target.value)}
          required
          value={productCode}
        />
        <TextField
          id="product-name"
          label="Product name"
          maxLength={255}
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
        <SelectField
          id="product-category"
          label="Category"
          onChange={setCategoryId}
          options={categories.map((category) => ({
            label: `${category.name} · ${trackingLabel(category.trackingMode)}`,
            value: category.id,
          }))}
          value={categoryId}
        />
        <SelectField
          id="product-unit"
          label="Unit"
          onChange={setUnitId}
          options={units.map((unit) => ({ label: `${unit.code} · ${unit.name}`, value: unit.id }))}
          value={unitId}
        />
        {selectedCategory?.trackingMode === 'serial' ? (
          <TextField
            id="product-warranty-months"
            label="Warranty term (months)"
            max={120}
            min={1}
            onChange={(event) => setWarrantyMonths(event.target.value)}
            required
            type="number"
            value={warrantyMonths}
          />
        ) : null}
        <div className="barcode-form">
          <div>
            <strong>Barcodes</strong>
            <button
              onClick={() =>
                setBarcodes((current) => [...current, { barcode: '', barcodeType: 'other' }])
              }
              type="button"
            >
              Add barcode
            </button>
          </div>
          {barcodes.map((barcode, index) => (
            <div className="barcode-form-row" key={index}>
              <input
                aria-label={`Barcode ${index + 1}`}
                maxLength={80}
                onChange={(event) =>
                  setBarcodes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, barcode: event.target.value } : item,
                    ),
                  )
                }
                placeholder="Optional barcode"
                value={barcode.barcode}
              />
              <select
                aria-label={`Barcode ${index + 1} type`}
                onChange={(event) =>
                  setBarcodes((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, barcodeType: event.target.value as typeof item.barcodeType }
                        : item,
                    ),
                  )
                }
                value={barcode.barcodeType}
              >
                <option value="other">Other</option>
                <option value="ean13">EAN-13</option>
                <option value="ean8">EAN-8</option>
                <option value="upca">UPC-A</option>
                <option value="code128">Code 128</option>
              </select>
              {barcodes.length > 1 ? (
                <button
                  aria-label={`Remove barcode ${index + 1}`}
                  onClick={() =>
                    setBarcodes((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {error ? (
          <InlineAlert tone="error" title="Product not saved">
            {error.message}
          </InlineAlert>
        ) : null}
        <DrawerActions onClose={onClose} saving={saving} submit="Add product" />
      </form>
    </CatalogDrawer>
  );
}

function SelectField({
  id,
  label,
  onChange,
  options,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <label className="catalog-select" htmlFor={id}>
      <span>{label}</span>
      <select id={id} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function DrawerActions({
  onClose,
  saving,
  submit,
}: {
  onClose: () => void;
  saving: boolean;
  submit: string;
}) {
  return (
    <div className="drawer-actions">
      <Button disabled={saving} onClick={onClose} variant="quiet">
        Close
      </Button>
      <Button busy={saving} busyLabel="Saving" type="submit">
        {submit}
      </Button>
    </div>
  );
}
function CatalogDrawer({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onClose]);
  return (
    <div className="catalog-drawer-layer" role="presentation">
      <button aria-label="Close" className="catalog-drawer-scrim" onClick={onClose} type="button" />
      <aside aria-label={title} aria-modal="true" className="catalog-drawer" role="dialog">
        <header className="panel-drawer-header">
          <button
            aria-label="Back to catalog"
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            Back
          </button>
          <button aria-label="Close" className="panel-close-button" onClick={onClose} type="button">
            <Icon name="close" />
          </button>
          <div>
            <p className="page-eyebrow">Product catalog</p>
            <h2>{title}</h2>
          </div>
        </header>
        <div className="catalog-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
function trackingLabel(mode: ProductSummary['trackingMode']): string {
  return mode === 'serial'
    ? 'Serial tracking'
    : mode === 'batch'
      ? 'Batch tracking'
      : 'No tracking';
}
