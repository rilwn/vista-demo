import { Button } from '@vista/ui';
import type { CustomerPaymentStatusFilter, CustomerPaymentStatusPage } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { listCustomerPaymentStatus } from '../api/finance';
import { Icon } from '../components/Icon';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { financePaymentStatusMessages } from './finance-payment-status.messages';

const emptyPage: CustomerPaymentStatusPage = {
  items: [],
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 1,
};

const statuses: CustomerPaymentStatusFilter[] = ['unpaid', 'partially_paid', 'paid', 'overdue'];

export function FinancePaymentStatusRegister({
  onOpenAccount,
  token,
}: {
  onOpenAccount: (customerPartnerId: string) => void;
  token: string;
}) {
  const { locale } = useLocalization();
  const copy = financePaymentStatusMessages(locale);
  const [data, setData] = useState(emptyPage);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerPaymentStatusFilter | ''>('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = searchInput.trim();
      setSearch(normalized.length >= 2 ? normalized : '');
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!token) return;
    let current = true;
    setLoading(true);
    setError(false);
    void listCustomerPaymentStatus(token, {
      page,
      pageSize: 25,
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    })
      .then((next) => {
        if (current) setData(next);
      })
      .catch(() => {
        if (current) setError(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, revision, search, status, token]);

  const countLabel = `${data.totalItems} ${data.totalItems === 1 ? copy.record : copy.records}`;

  return (
    <section aria-label={copy.title} className="finance-payment-status">
      <header className="finance-payment-status-heading">
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <span aria-live="polite" className="finance-payment-status-count">
          {loading && !data.totalItems ? copy.loading : countLabel}
        </span>
      </header>

      <div className="finance-payment-status-filters">
        <label className="finance-payment-status-search">
          <span className="sr-only">{copy.search}</span>
          <Icon name="search" size={17} />
          <input
            aria-label={copy.search}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={copy.search}
            type="search"
            value={searchInput}
          />
        </label>
        <label className="finance-payment-status-filter">
          <span>{copy.status}</span>
          <select
            aria-label={copy.status}
            onChange={(event) => {
              setStatus(event.target.value as CustomerPaymentStatusFilter | '');
              setPage(1);
            }}
            value={status}
          >
            <option value="">{copy.allStatuses}</option>
            {statuses.map((item) => (
              <option key={item} value={item}>
                {copy[item]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="finance-payment-status-hint">{copy.searchHint}</p>

      {error ? (
        <div className="finance-payment-status-message" role="alert">
          <span>{copy.error}</span>
          <Button onClick={() => setRevision((value) => value + 1)} variant="secondary">
            {copy.retry}
          </Button>
        </div>
      ) : data.items.length ? (
        <div aria-busy={loading} className="finance-payment-status-table">
          <div className="finance-payment-status-table-head" aria-hidden="true">
            <span>{copy.customer}</span>
            <span>{copy.source}</span>
            <span>{copy.dueDate}</span>
            <span>{copy.documentTotal}</span>
            <span>{copy.paidAmount}</span>
            <span>{copy.outstanding}</span>
            <span>{copy.status}</span>
            <span />
          </div>
          {data.items.map((record) => (
            <article
              className="finance-payment-status-row"
              key={`${record.sourceType}:${record.id}`}
            >
              <div className="finance-payment-status-customer" data-label={copy.customer}>
                <strong>{record.customerName}</strong>
              </div>
              <div className="finance-payment-status-source" data-label={copy.source}>
                <strong>{record.number}</strong>
                <small>
                  {record.sourceType === 'pos_sale' ? copy.pos : copy.invoice}
                  {record.referenceNumber
                    ? ` · ${record.sourceType === 'pos_sale' ? copy.receipt : copy.reference}: ${record.referenceNumber}`
                    : ''}
                </small>
              </div>
              <div data-label={copy.dueDate}>
                {formatOperationsDate(new Date(`${record.dueDate}T12:00:00Z`), {
                  dateStyle: 'medium',
                  timeZone: 'UTC',
                })}
              </div>
              <div data-label={copy.documentTotal}>
                {formatOperationsCurrency(record.total, record.currencyCode)}
              </div>
              <div data-label={copy.paidAmount}>
                <strong>{formatOperationsCurrency(record.paidTotal, record.currencyCode)}</strong>
                {Number(record.creditTotal) > 0 ? (
                  <small>
                    {copy.credit}:{' '}
                    {formatOperationsCurrency(record.creditTotal, record.currencyCode)}
                  </small>
                ) : null}
              </div>
              <div className="finance-payment-status-amount" data-label={copy.outstanding}>
                {formatOperationsCurrency(record.outstandingTotal, record.currencyCode)}
              </div>
              <div data-label={copy.status}>
                <span className={`finance-payment-status-badge is-${record.paymentStatus}`}>
                  {copy[record.paymentStatus]}
                </span>
              </div>
              <div className="finance-payment-status-action">
                <Button onClick={() => onOpenAccount(record.customerPartnerId)} variant="quiet">
                  {copy.openAccount}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="finance-payment-status-empty" aria-live="polite">
          {loading ? copy.loading : search || status ? copy.noResults : copy.noRecords}
        </div>
      )}

      <footer className="finance-payment-status-pagination">
        <Button
          disabled={page <= 1 || loading}
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          variant="secondary"
        >
          {copy.previous}
        </Button>
        <span aria-live="polite">
          {copy.page} {data.page} {copy.of} {data.totalPages}
        </span>
        <Button
          disabled={page >= data.totalPages || loading}
          onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}
          variant="secondary"
        >
          {copy.next}
        </Button>
      </footer>
    </section>
  );
}
