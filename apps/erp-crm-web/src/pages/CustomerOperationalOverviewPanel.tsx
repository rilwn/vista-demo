import { Button, InlineAlert } from '@vista/ui';
import type {
  CustomerFinancialDocumentSummary,
  CustomerOperationalOverview,
  CustomerPaymentSummary,
  CustomerPurchaseHistoryEntry,
  CustomerReceivableSummary,
} from '@vista/contracts';
import { useEffect, useState, type ReactNode } from 'react';

import { getCustomerOperationalOverview } from '../api/partners';
import { Icon } from '../components/Icon';

export function CustomerOperationalOverviewPanel({
  partnerId,
  token,
}: {
  partnerId: string;
  token: string;
}) {
  const [data, setData] = useState<CustomerOperationalOverview | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void getCustomerOperationalOverview(token, partnerId)
      .then((result) => {
        if (active) setData(result);
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
  }, [partnerId, refresh, token]);

  if (loading) return <OverviewSkeleton />;
  if (error || !data) {
    return (
      <InlineAlert title="Customer overview unavailable" tone="error">
        <p>The customer records could not be loaded.</p>
        <Button onClick={() => setRefresh((value) => value + 1)} variant="secondary">
          Try again
        </Button>
      </InlineAlert>
    );
  }

  const primaryContact = data.profile.contacts[0];
  const primaryAddress = data.profile.addresses[0];
  return (
    <div className="customer-overview">
      <header className="customer-overview-hero">
        <span className="customer-overview-mark" aria-hidden="true">
          <Icon name="customers" size={22} />
        </span>
        <div>
          <p className="page-eyebrow">Shared customer record</p>
          <h2>{data.profile.partner.displayName}</h2>
          <p>
            {[primaryContact?.displayName, primaryContact?.telephone, primaryAddress?.city]
              .filter(Boolean)
              .join(' · ') || 'Customer contact details have not been added yet.'}
          </p>
        </div>
        <span
          className={`customer-overview-state ${data.profile.partner.active ? '' : 'is-muted'}`}
        >
          {data.profile.partner.active ? 'Active' : 'Inactive'}
        </span>
      </header>

      <section className="customer-overview-metrics" aria-label="Customer summary">
        <OverviewMetric
          emphasis={Number(data.summary.outstandingBgn) > 0}
          label="Outstanding"
          value={money(data.summary.outstandingBgn, 'BGN')}
        />
        <OverviewMetric label="Purchases" value={String(data.summary.purchases)} />
        <OverviewMetric
          label="Locations & equipment"
          value={`${data.summary.activeLocations} · ${data.summary.activeEquipment}`}
        />
        <OverviewMetric
          label="Last purchase"
          value={data.summary.lastPurchaseAt ? date(data.summary.lastPurchaseAt) : 'No purchases'}
        />
      </section>

      <OverviewSection
        count={data.receivables.length}
        empty="No collection records have been prepared."
        subtitle="Balances, payment state, and due dates"
        title="Receivables"
      >
        {data.receivables.map((receivable) => (
          <ReceivableRow key={receivable.id} record={receivable} />
        ))}
      </OverviewSection>

      <OverviewSection
        count={data.summary.purchases}
        empty="No completed sales are connected to this customer yet."
        subtitle="Products supplied through ERP Sales and the POS counter"
        title="Purchase history"
      >
        {data.purchases.map((purchase) => (
          <PurchaseRow key={purchase.id} record={purchase} />
        ))}
      </OverviewSection>

      <OverviewSection
        count={data.locations.length}
        empty="No customer locations have been registered."
        subtitle="Sites and installed customer equipment"
        title="Locations & equipment"
      >
        {data.locations.map((location) => (
          <article className="customer-overview-location" key={location.location.id}>
            <div>
              <strong>{location.location.name}</strong>
              <span>
                {location.location.locationType} · {location.location.city}
              </span>
            </div>
            <span>{plural(location.equipment.length, 'device', 'devices')}</span>
            {location.equipment.length > 0 ? (
              <ul>
                {location.equipment.map((equipment) => (
                  <li key={equipment.id}>
                    <span>{equipment.deviceName}</span>
                    <code>{equipment.serialNumber}</code>
                    <small>{statusLabel(equipment.status)}</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </OverviewSection>

      <div className="customer-overview-split">
        <OverviewSection
          count={data.summary.financialDocuments}
          empty="No financial documents have been prepared."
          subtitle="Invoices and corrections"
          title="Financial documents"
        >
          {data.financialDocuments.map((document) => (
            <DocumentRow key={document.id} record={document} />
          ))}
        </OverviewSection>
        <OverviewSection
          count={data.summary.payments}
          empty="No customer payments have been recorded."
          subtitle="Most recent receipts and transfers"
          title="Payments"
        >
          {data.payments.map((payment) => (
            <PaymentRow key={payment.id} record={payment} />
          ))}
        </OverviewSection>
      </div>
    </div>
  );
}

function OverviewMetric({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean;
  label: string;
  value: string;
}) {
  return (
    <article className={emphasis ? 'is-emphasis' : undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function OverviewSection({
  children,
  count,
  empty,
  subtitle,
  title,
}: {
  children: ReactNode;
  count: number;
  empty: string;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="customer-overview-section">
      <header>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>{count}</span>
      </header>
      <div className="customer-overview-list">
        {count === 0 ? <p className="customer-overview-empty">{empty}</p> : children}
      </div>
    </section>
  );
}

function ReceivableRow({ record }: { record: CustomerReceivableSummary }) {
  return (
    <article className="customer-overview-row">
      <div>
        <strong>{record.number}</strong>
        <span>Due {date(record.dueDate)}</span>
      </div>
      <div>
        <strong>{money(record.outstandingTotal, record.currencyCode)}</strong>
        <span className={`customer-overview-pill is-${record.paymentStatus}`}>
          {statusLabel(record.paymentStatus)}
        </span>
      </div>
    </article>
  );
}

function PurchaseRow({ record }: { record: CustomerPurchaseHistoryEntry }) {
  return (
    <article className="customer-overview-row is-purchase">
      <div>
        <strong>{record.number}</strong>
        <span>
          {record.source === 'pos' ? 'POS sale' : 'ERP sale'} · {date(record.recordedAt)}
        </span>
        <small>{record.lines.map((line) => line.productName).join(', ')}</small>
      </div>
      <strong>{money(record.total, record.currencyCode)}</strong>
    </article>
  );
}

function DocumentRow({ record }: { record: CustomerFinancialDocumentSummary }) {
  return (
    <article className="customer-overview-row">
      <div>
        <strong>{record.officialNumber ?? record.draftNumber}</strong>
        <span>
          {documentLabel(record.documentType)} · {date(record.issueDate)}
        </span>
      </div>
      <div>
        <strong>{money(record.grossTotal, record.currencyCode)}</strong>
        <span className={`customer-overview-pill is-${record.status}`}>
          {statusLabel(record.status)}
        </span>
      </div>
    </article>
  );
}

function PaymentRow({ record }: { record: CustomerPaymentSummary }) {
  return (
    <article className="customer-overview-row">
      <div>
        <strong>{record.number}</strong>
        <span>
          {paymentLabel(record.paymentMethod)} · {date(record.paymentDate)}
        </span>
      </div>
      <strong>{money(record.amount, record.currencyCode)}</strong>
    </article>
  );
}

function OverviewSkeleton() {
  return (
    <div
      aria-label="Loading customer overview"
      className="customer-overview-skeleton"
      role="status"
    >
      <span />
      <div>
        <span />
        <span />
        <span />
        <span />
      </div>
      <span />
      <span />
    </div>
  );
}

function money(value: string, currencyCode: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currencyCode} ${value}`;
  return new Intl.NumberFormat(undefined, {
    currency: currencyCode,
    currencyDisplay: 'code',
    style: 'currency',
  }).format(amount);
}

function date(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    active: 'Active',
    cancelled: 'Cancelled',
    draft: 'Prepared',
    overdue: 'Overdue',
    paid: 'Paid',
    partially_paid: 'Partially paid',
    retired: 'Retired',
    under_repair: 'Under repair',
    unpaid: 'Unpaid',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function documentLabel(value: CustomerFinancialDocumentSummary['documentType']): string {
  return {
    credit_note: 'Credit note',
    debit_note: 'Debit note',
    invoice: 'Invoice',
    proforma: 'Proforma invoice',
  }[value];
}

function paymentLabel(value: CustomerPaymentSummary['paymentMethod']): string {
  return {
    bank_transfer: 'Bank transfer',
    card: 'Card',
    cash: 'Cash',
    offset: 'Offset',
    pos_terminal: 'POS terminal',
  }[value];
}

function plural(count: number, singular: string, multiple: string): string {
  return `${count} ${count === 1 ? singular : multiple}`;
}
