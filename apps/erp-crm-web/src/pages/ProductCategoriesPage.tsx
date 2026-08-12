import { Button, InlineAlert, TextField } from '@vista/ui';
import type {
  CreateProductCategoryRequest,
  ProductCategory,
  ProductTrackingMode,
} from '@vista/contracts';
import { type CSSProperties, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { createProductCategory, listProductCategories } from '../api/product-categories';
import { ApiClientError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { messages } from '../messages';

export function ProductCategoriesPage() {
  const { hasPermission, session } = useAuth();
  const [categories, setCategories] = useState<ProductCategory[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [success, setSuccess] = useState('');
  const token = session?.sessionToken;
  const canCreate = hasPermission('erp.warehouse', 'create');

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void listProductCategories(token)
      .then((result) => {
        if (active) setCategories(result);
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
  }, [refresh, token]);

  return (
    <div className="page-stack category-page">
      <header className="page-header category-header">
        <div>
          <p className="page-eyebrow">{messages.categories.eyebrow}</p>
          <h1>{messages.categories.title}</h1>
          <p>{messages.categories.subtitle}</p>
        </div>
        {canCreate ? (
          <Button onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={17} />
            {messages.categories.create}
          </Button>
        ) : null}
      </header>

      {success ? (
        <InlineAlert tone="success">
          <div className="partners-inline-message">
            <span>{success}</span>
            <button onClick={() => setSuccess('')} type="button">
              {messages.partners.close}
            </button>
          </div>
        </InlineAlert>
      ) : null}

      <section className="category-registry" aria-labelledby="category-registry-heading">
        <div className="registry-meta">
          <h2 id="category-registry-heading">{messages.categories.hierarchyTitle}</h2>
          <span>
            {categories && !loading ? messages.categories.results(categories.length) : '\u00a0'}
          </span>
        </div>
        {loading ? <CategorySkeleton /> : null}
        {error ? (
          <CategoryState title={messages.categories.loadError}>
            <Button onClick={() => setRefresh((value) => value + 1)} variant="secondary">
              {messages.partners.retry}
            </Button>
          </CategoryState>
        ) : null}
        {!loading && !error && categories?.length === 0 ? (
          <CategoryState title={messages.categories.emptyTitle}>
            <p>{messages.categories.emptyDescription}</p>
            {canCreate ? (
              <Button onClick={() => setShowCreate(true)} variant="secondary">
                <Icon name="plus" size={16} />
                {messages.categories.emptyAction}
              </Button>
            ) : null}
          </CategoryState>
        ) : null}
        {!loading && !error && categories && categories.length > 0 ? (
          <CategoryTree categories={categories} />
        ) : null}
      </section>

      {showCreate && token && categories ? (
        <CreateCategoryDrawer
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setSuccess(messages.categories.created);
            setRefresh((value) => value + 1);
          }}
          token={token}
        />
      ) : null}
    </div>
  );
}

function CategoryTree({ categories }: { categories: ProductCategory[] }) {
  const byParent = useMemo(() => {
    const map = new Map<string | undefined, ProductCategory[]>();
    for (const category of categories) {
      const parent = category.parentId;
      const existing = map.get(parent) ?? [];
      existing.push(category);
      map.set(parent, existing);
    }
    return map;
  }, [categories]);
  const categoryIds = useMemo(
    () => new Set(categories.map((category) => category.id)),
    [categories],
  );
  const roots = [
    ...(byParent.get(undefined) ?? []),
    ...categories.filter((category) => category.parentId && !categoryIds.has(category.parentId)),
  ];
  return (
    <div className="category-tree" role="tree">
      {roots.map((category) => (
        <CategoryBranch byParent={byParent} category={category} depth={0} key={category.id} />
      ))}
    </div>
  );
}

function CategoryBranch({
  byParent,
  category,
  depth,
}: {
  byParent: Map<string | undefined, ProductCategory[]>;
  category: ProductCategory;
  depth: number;
}) {
  const children = byParent.get(category.id) ?? [];
  return (
    <div className="category-branch" role="treeitem">
      <div className="category-node" style={{ '--category-depth': depth } as CSSProperties}>
        <span className="category-node-mark" aria-hidden="true">
          <Icon name="warehouse" size={15} />
        </span>
        <span className="category-node-copy">
          <strong>{category.name}</strong>
          <span>
            {trackingLabel(category.trackingMode)}
            {category.requiresExpiry ? ' · Expiry required' : ''}
          </span>
        </span>
        {children.length > 0 ? (
          <small>{messages.categories.childCount(children.length)}</small>
        ) : null}
      </div>
      {children.length > 0 ? (
        <div role="group">
          {children.map((child) => (
            <CategoryBranch byParent={byParent} category={child} depth={depth + 1} key={child.id} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CreateCategoryDrawer({
  categories,
  onClose,
  onCreated,
  token,
}: {
  categories: ProductCategory[];
  onClose: () => void;
  onCreated: () => void;
  token: string;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [requiresExpiry, setRequiresExpiry] = useState(false);
  const [trackingMode, setTrackingMode] = useState<ProductTrackingMode>('none');
  const [error, setError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);
  const lastAttempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const options = useMemo(() => categoryOptions(categories), [categories]);

  useDrawerEscape(onClose);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreateProductCategoryRequest = {
      name: name.trim(),
      ...(parentId ? { parentId } : {}),
      requiresExpiry,
      trackingMode,
    };
    if (!input.name) return;
    const fingerprint = JSON.stringify(input);
    const attempt =
      lastAttempt.current?.fingerprint === fingerprint
        ? lastAttempt.current
        : { fingerprint, key: crypto.randomUUID() };
    lastAttempt.current = attempt;
    setSaving(true);
    setError(null);
    try {
      await createProductCategory(token, attempt.key, input);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught
          : new ApiClientError(messages.categories.saveError, 'UNKNOWN', 0),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer onClose={onClose} title={messages.categories.createTitle}>
      <div className="drawer-heading">
        <p className="page-eyebrow">{messages.categories.createEyebrow}</p>
        <h2>{messages.categories.createTitle}</h2>
        <p>{messages.categories.createDescription}</p>
      </div>
      <form className="partner-form" onSubmit={(event) => void submit(event)}>
        <TextField
          autoFocus
          id="category-name"
          label={messages.categories.name}
          maxLength={150}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          required
          value={name}
        />
        <label className="category-parent-select" htmlFor="category-parent">
          <span>{messages.categories.parent}</span>
          <select
            id="category-parent"
            onChange={(event) => setParentId(event.target.value)}
            value={parentId}
          >
            <option value="">{messages.categories.rootCategory}</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="category-tracking-fieldset">
          <legend>{messages.categories.trackingPolicy}</legend>
          <p>{messages.categories.trackingDescription}</p>
          <div className="category-tracking-options">
            {(
              [
                ['none', messages.categories.noTracking, 'Track stock by quantity.'],
                [
                  'serial',
                  messages.categories.serialTracking,
                  'Require one unique serial number per item.',
                ],
                [
                  'batch',
                  messages.categories.batchTracking,
                  'Require a supplier or production batch number.',
                ],
              ] as const
            ).map(([value, label, description]) => (
              <label className={trackingMode === value ? 'is-selected' : undefined} key={value}>
                <input
                  checked={trackingMode === value}
                  name="category-tracking-mode"
                  onChange={() => {
                    setTrackingMode(value);
                    if (value !== 'batch') setRequiresExpiry(false);
                  }}
                  type="radio"
                  value={value}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {trackingMode === 'batch' ? (
          <label className="category-expiry-control">
            <input
              checked={requiresExpiry}
              onChange={(event) => setRequiresExpiry(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{messages.categories.requiresExpiry}</strong>
              <small>Leave this clear when expiry dates do not apply to the category.</small>
            </span>
          </label>
        ) : null}
        {error ? (
          <InlineAlert title={messages.categories.saveError} tone="error">
            <p>{error.message}</p>
          </InlineAlert>
        ) : null}
        <div className="drawer-actions">
          <Button disabled={saving} onClick={onClose} variant="quiet">
            {messages.partners.close}
          </Button>
          <Button busy={saving} busyLabel={messages.categories.saving} type="submit">
            {messages.categories.save}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function trackingLabel(mode: ProductTrackingMode): string {
  if (mode === 'serial') return messages.categories.serialTracking;
  if (mode === 'batch') return messages.categories.batchTracking;
  return messages.categories.noTracking;
}

function categoryOptions(categories: ProductCategory[]) {
  const byParent = new Map<string | undefined, ProductCategory[]>();
  for (const category of categories) {
    const siblings = byParent.get(category.parentId) ?? [];
    siblings.push(category);
    byParent.set(category.parentId, siblings);
  }
  const result: Array<ProductCategory & { label: string }> = [];
  function visit(parentId: string | undefined, depth: number) {
    for (const category of byParent.get(parentId) ?? []) {
      result.push({ ...category, label: `${'— '.repeat(depth)}${category.name}` });
      visit(category.id, depth + 1);
    }
  }
  visit(undefined, 0);
  return result;
}

function CategoryState({ children, title }: { children?: React.ReactNode; title: string }) {
  return (
    <div className="registry-state">
      <span className="registry-state-mark" aria-hidden="true">
        <Icon name="warehouse" size={22} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function CategorySkeleton() {
  return (
    <div aria-label={messages.states.loading} className="registry-skeleton" role="status">
      {[0, 1, 2, 3].map((item) => (
        <span key={item} />
      ))}
    </div>
  );
}

function Drawer({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="drawer-layer">
      <button
        aria-label={messages.partners.close}
        className="drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label={title} aria-modal="true" className="record-drawer" role="dialog">
        <div className="record-drawer-navigation">
          <button
            aria-label="Back to categories"
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            Back
          </button>
          <button
            aria-label={messages.partners.close}
            className="drawer-close panel-close-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function useDrawerEscape(onClose: () => void) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onClose]);
}
