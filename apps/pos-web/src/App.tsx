import { useState } from 'react';

import { messages } from './messages';

type PosScreen = 'customers' | 'reports' | 'returns' | 'sales' | 'sell' | 'shifts' | 'sync';

const screenLabels: Record<PosScreen, string> = {
  customers: 'Customers & loyalty',
  reports: 'POS reports',
  returns: 'Returns',
  sales: 'Sale history',
  sell: 'Sell',
  shifts: 'Shifts',
  sync: 'Sync & devices',
};

export function App() {
  const [screen, setScreen] = useState<PosScreen>('sell');
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="pos-terminal">
      <header className="pos-topbar">
        <div className="pos-brand">
          <span aria-hidden="true" className="pos-brand-mark">
            VS
          </span>
          <div>
            <strong>Vista POS</strong>
            <small>Terminal workspace</small>
          </div>
        </div>
        <div className="pos-terminal-context">
          <span className="pos-context-label">Terminal</span>
          <strong>Not configured</strong>
        </div>
        <div className="pos-system-status" aria-label="Terminal system status">
          <span className="pos-status-dot is-warning" />
          <span>{messages.status}</span>
          <button
            onClick={() =>
              setNotice(
                'Terminal, fiscal-device, and ERP configuration will be connected in the POS integration phase.',
              )
            }
            type="button"
          >
            Status details
          </button>
        </div>
      </header>

      <div className="pos-workspace">
        <nav aria-label="POS navigation" className="pos-nav">
          {(Object.keys(screenLabels) as PosScreen[]).map((item) => (
            <button
              className={screen === item ? 'is-active' : undefined}
              key={item}
              onClick={() => {
                setScreen(item);
                setNotice(null);
              }}
              type="button"
            >
              <span className={`pos-nav-symbol pos-nav-symbol--${item}`} aria-hidden="true" />
              {screenLabels[item]}
            </button>
          ))}
        </nav>

        <main className="pos-main">
          {notice ? (
            <div className="pos-notice" role="status">
              <span />
              <p>{notice}</p>
              <button aria-label="Dismiss notice" onClick={() => setNotice(null)} type="button">
                ×
              </button>
            </div>
          ) : null}
          {screen === 'sell' ? (
            <SellScreen onNotice={setNotice} />
          ) : (
            <RegisterScreen onNotice={setNotice} screen={screen} />
          )}
        </main>
      </div>

      <footer className="pos-footer">
        <span>
          <i className="is-warning" /> ERP catalog unavailable
        </span>
        <span>
          <i className="is-warning" /> Fiscal device unassigned
        </span>
        <span>
          <i className="is-muted" /> Offline queue not enabled
        </span>
        <span className="pos-footer-end">
          All payment, fiscalization, stock, and sync actions remain disabled until verified
          integrations are connected.
        </span>
      </footer>
    </div>
  );
}

function SellScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const [query, setQuery] = useState('');

  return (
    <div className="pos-sale-layout">
      <section className="pos-catalog-panel" aria-labelledby="sale-title">
        <header className="pos-page-heading">
          <div>
            <p>Point of sale</p>
            <h1 id="sale-title">New sale</h1>
          </div>
          <button
            className="pos-quiet-button"
            onClick={() =>
              onNotice('A cashier must open a verified shift before sales can be enabled.')
            }
            type="button"
          >
            Open shift
          </button>
        </header>

        <div className="pos-search-shell">
          <label htmlFor="pos-product-search">Search or scan</label>
          <input
            autoComplete="off"
            id="pos-product-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Scan barcode, enter product code, or search by name"
            value={query}
          />
          <kbd>F2</kbd>
        </div>

        <div className="pos-catalog-toolbar">
          <div className="pos-category-tabs" aria-label="Catalog categories">
            <button className="is-active" type="button">
              All items
            </button>
            <button type="button">Quick access</button>
            <button type="button">Categories</button>
          </div>
          <button
            className="pos-text-button"
            onClick={() => onNotice('ERP catalog synchronization is not connected yet.')}
            type="button"
          >
            Catalog status
          </button>
        </div>

        <div className="pos-catalog-empty">
          <span className="pos-empty-mark" aria-hidden="true">
            ⌁
          </span>
          <h2>Ready for a scanned item</h2>
          <p>
            The product grid will show real-time ERP stock, prices, promotions, and serial
            requirements once the catalog integration is enabled.
          </p>
          <div>
            <span>Barcode scanning</span>
            <span>Product / code search</span>
            <span>Quick-access panel</span>
          </div>
        </div>

        <section className="pos-action-strip" aria-label="Sale shortcuts">
          <button
            onClick={() =>
              onNotice('Customer lookup will use the shared CRM profile when connected.')
            }
            type="button"
          >
            <b>F4</b> Customer
          </button>
          <button
            onClick={() => onNotice('Discounts require an eligible line and role permission.')}
            type="button"
          >
            <b>F6</b> Discount
          </button>
          <button
            onClick={() =>
              onNotice('Suspended baskets will be stored through the POS basket service.')
            }
            type="button"
          >
            <b>F8</b> Suspend
          </button>
          <button
            onClick={() =>
              onNotice(
                'A sale can only be completed after products, a shift, a payment, and fiscal-device rules are available.',
              )
            }
            type="button"
          >
            <b>F12</b> Pay
          </button>
        </section>
      </section>

      <aside className="pos-basket" aria-label="Current sale basket">
        <header className="pos-basket-header">
          <div>
            <p>Current sale</p>
            <strong>No customer selected</strong>
          </div>
          <button
            onClick={() =>
              onNotice(
                'Customer identification and loyalty lookup will use the shared CRM profile.',
              )
            }
            type="button"
          >
            Add customer
          </button>
        </header>

        <div className="pos-basket-empty">
          <span aria-hidden="true">0</span>
          <p>No items in this sale</p>
          <small>Scan an item or use product search to begin.</small>
        </div>

        <div className="pos-totals">
          <div>
            <span>Subtotal</span>
            <strong>0.00 BGN</strong>
          </div>
          <div>
            <span>Discount</span>
            <strong>0.00 BGN</strong>
          </div>
          <div className="pos-total">
            <span>Total due</span>
            <strong>0.00 BGN</strong>
          </div>
        </div>

        <div className="pos-payment-grid" aria-label="Payment methods">
          <button disabled type="button">
            Cash
          </button>
          <button disabled type="button">
            Card
          </button>
          <button disabled type="button">
            On account
          </button>
          <button disabled type="button">
            Split payment
          </button>
        </div>
        <button className="pos-pay-button" disabled type="button">
          Pay · F12
        </button>
        <p className="pos-basket-disclaimer">
          Payment remains unavailable until a cashier shift, fiscal setup, pricing, and stock
          synchronization are connected.
        </p>
      </aside>
    </div>
  );
}

function RegisterScreen({
  onNotice,
  screen,
}: {
  onNotice: (message: string) => void;
  screen: Exclude<PosScreen, 'sell'>;
}) {
  const content: Record<
    Exclude<PosScreen, 'sell'>,
    { action: string; description: string; sections: string[]; title: string }
  > = {
    customers: {
      title: 'Customers & loyalty',
      action: 'Find customer',
      description:
        'Identify customers, apply contract pricing, and maintain an auditable loyalty-points ledger.',
      sections: [
        'Unified CRM profile',
        'Loyalty card and points ledger',
        'Corporate on-account eligibility',
      ],
    },
    reports: {
      title: 'POS reports',
      action: 'Create report',
      description:
        'Run shift, cashier, X/Z, product, category, payment, location, and comparative reports.',
      sections: [
        'Configurable time and location filters',
        'Export to Excel, CSV, and PDF',
        'Access-controlled report history',
      ],
    },
    returns: {
      title: 'Returns & warranty claims',
      action: 'Start return',
      description:
        'Link returns to the original fiscal document and route eligible goods to inventory or service.',
      sections: [
        'Original receipt/invoice reference',
        'Fiscal reversal workflow',
        'Repairable-item service warehouse handoff',
      ],
    },
    sales: {
      title: 'Sale history',
      action: 'Find sale',
      description:
        'Find fiscal sales, invoices, payments, linked returns, and recoverable processing status.',
      sections: [
        'Fiscal receipt and invoice linkage',
        'Split-payment visibility',
        'Idempotent transaction and reconciliation trail',
      ],
    },
    shifts: {
      title: 'Cashier shifts',
      action: 'Open shift',
      description:
        'Manage terminal/register/operator context, opening cash, closeout, and X/Z reporting.',
      sections: ['Register and operator assignment', 'Cash reconciliation', 'Shift audit trail'],
    },
    sync: {
      title: 'Sync & devices',
      action: 'Configure integration',
      description:
        'Monitor ERP synchronization, fiscal device, PIN pad, barcode scanner, and offline queue readiness.',
      sections: [
        'Vendor-neutral hardware adapters',
        'Retry and reconciliation log',
        'Offline status and unsynchronized count',
      ],
    },
  };
  const page = content[screen];
  return (
    <div className="pos-register-page">
      <header className="pos-page-heading">
        <div>
          <p>Point of sale</p>
          <h1>{page.title}</h1>
          <span>{page.description}</span>
        </div>
        <button
          className="pos-primary-button"
          onClick={() =>
            onNotice(
              `${page.action} will be enabled with the POS API and hardware integration phase.`,
            )
          }
          type="button"
        >
          {page.action}
        </button>
      </header>
      <div className="pos-register-controls">
        <label>
          <span>Search</span>
          <input placeholder={`Search ${page.title.toLowerCase()}`} />
        </label>
        <button type="button">All statuses</button>
        <button type="button">Today</button>
      </div>
      <section className="pos-register-empty">
        <div>
          <span aria-hidden="true">—</span>
          <h2>No live records</h2>
          <p>
            This operational screen is designed and ready for its POS APIs. No sale, customer,
            fiscal, or hardware data is simulated.
          </p>
        </div>
      </section>
      <section className="pos-requirement-cards">
        {page.sections.map((section) => (
          <article key={section}>
            <span>Included workflow</span>
            <strong>{section}</strong>
          </article>
        ))}
      </section>
    </div>
  );
}
