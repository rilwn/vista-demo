import { useActiveItemVisibility } from '@vista/ui/navigation';
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

const screenIcons: Record<PosScreen, PosIconName> = {
  customers: 'customers',
  reports: 'reports',
  returns: 'returns',
  sales: 'sales',
  sell: 'sell',
  shifts: 'shifts',
  sync: 'devices',
};

const screenOrder: PosScreen[] = [
  'sell',
  'sales',
  'returns',
  'customers',
  'shifts',
  'reports',
  'sync',
];

export function App() {
  const [screen, setScreen] = useState<PosScreen>('sell');
  const [notice, setNotice] = useState<string | null>(null);
  const navigation = useActiveItemVisibility<HTMLElement>(screen);

  return (
    <div className="pos-terminal">
      <header className="pos-topbar">
        <div className="pos-brand">
          <span aria-hidden="true" className="pos-brand-mark">
            VS
          </span>
          <div>
            <strong>Vista POS</strong>
            <small>Cashier terminal</small>
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
                'This terminal has not been set up. Assign a register and devices before taking a payment.',
              )
            }
            type="button"
          >
            Status details
          </button>
        </div>
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
                setNotice(null);
              }}
              type="button"
            >
              <PosIcon name={screenIcons[item]} />
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
                <PosIcon name="close" />
              </button>
            </div>
          ) : null}
          {screen === 'sell' ? (
            <SellScreen onNotice={setNotice} />
          ) : (
            <RegisterScreen screen={screen} />
          )}
        </main>
      </div>

      <footer className="pos-footer">
        <span>
          <i className="is-warning" /> Product catalog unavailable
        </span>
        <span>
          <i className="is-warning" /> Fiscal device not assigned
        </span>
        <span>
          <i className="is-muted" /> Offline mode unavailable
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
            onClick={() => onNotice('Open a cashier shift before starting a sale.')}
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
            onClick={() => onNotice('The product catalog is not available on this terminal.')}
            type="button"
          >
            Catalog status
          </button>
        </div>

        <div className="pos-catalog-empty">
          <span className="pos-empty-mark" aria-hidden="true">
            <PosIcon name="scan" />
          </span>
          <h2>Scan a product to begin</h2>
          <p>Use the scanner or search by product name or code.</p>
        </div>

        <section className="pos-action-strip" aria-label="Sale shortcuts">
          <button onClick={() => onNotice('Customer search is unavailable.')} type="button">
            <kbd>F4</kbd> Customer
          </button>
          <button
            onClick={() => onNotice('Add a product before applying a discount.')}
            type="button"
          >
            <kbd>F6</kbd> Discount
          </button>
          <button
            onClick={() => onNotice('Add a product before suspending the sale.')}
            type="button"
          >
            <kbd>F8</kbd> Suspend
          </button>
          <button
            onClick={() => onNotice('Add a product and open a shift before taking payment.')}
            type="button"
          >
            <kbd>F12</kbd> Pay
          </button>
        </section>
      </section>

      <aside className="pos-basket" aria-label="Current sale basket">
        <header className="pos-basket-header">
          <div>
            <p>Current sale</p>
            <strong>No customer selected</strong>
          </div>
          <button onClick={() => onNotice('Customer search is unavailable.')} type="button">
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
          Open a cashier shift and assign a fiscal device to take payment.
        </p>
      </aside>
    </div>
  );
}

function RegisterScreen({ screen }: { screen: Exclude<PosScreen, 'sell'> }) {
  const content: Record<
    Exclude<PosScreen, 'sell'>,
    { action: string; description: string; title: string }
  > = {
    customers: {
      title: 'Customers & loyalty',
      action: 'Find customer',
      description:
        'Identify customers, apply contract pricing, and maintain an auditable loyalty-points ledger.',
    },
    reports: {
      title: 'POS reports',
      action: 'Create report',
      description:
        'Run shift, cashier, X/Z, product, category, payment, location, and comparative reports.',
    },
    returns: {
      title: 'Returns & warranty claims',
      action: 'Start return',
      description:
        'Link returns to the original fiscal document and route eligible goods to inventory or service.',
    },
    sales: {
      title: 'Sale history',
      action: 'Find sale',
      description:
        'Find fiscal sales, invoices, payments, linked returns, and any processing issues.',
    },
    shifts: {
      title: 'Cashier shifts',
      action: 'Open shift',
      description:
        'Assign the terminal, cash register, and operator, then manage opening cash, closeout, and X/Z reports.',
    },
    sync: {
      title: 'Sync & devices',
      action: 'Set up devices',
      description:
        'Check product updates, the fiscal device, PIN pad, barcode scanner, and offline status.',
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
        <button className="pos-primary-button" disabled title="Unavailable" type="button">
          {page.action}
        </button>
      </header>
      <div className="pos-register-controls">
        <label>
          <span>Search</span>
          <input disabled placeholder={`Search ${page.title.toLowerCase()}`} />
        </label>
        <button disabled type="button">
          All statuses
        </button>
        <button disabled type="button">
          Today
        </button>
      </div>
      <section className="pos-register-empty">
        <div>
          <span aria-hidden="true">
            <PosIcon name={screenIcons[screen]} />
          </span>
          <h2>No records yet</h2>
          <p>Records for this area will appear here.</p>
        </div>
      </section>
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

const posIconPaths: Record<PosIconName, React.ReactNode> = {
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
