import { Button, InlineAlert, TextField } from '@vista/ui';
import type { PartnerPage, PartnerProfile, PartnerSummary } from '@vista/contracts';
import { useEffect, useState } from 'react';

import { getPartnerProfile, listPartners } from '../api/partners';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { useLocalization } from '../i18n/LocalizationProvider';
import { CustomerAssetsPanel } from './CustomerAssetsPanel';
import { CrmTabs } from './CrmTicketsPage';

export function CrmLocationsEquipmentPage() {
  const { hasPermission, session } = useAuth();
  const { t } = useLocalization();
  const [data, setData] = useState<PartnerPage | null>(null);
  const [search, setSearch] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<PartnerSummary | null>(null);
  const token = session?.sessionToken ?? '';

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      void listPartners(token, {
        direction: 'asc',
        page: pageNumber,
        pageSize: 25,
        role: 'customer',
        ...(search.trim() ? { search: search.trim() } : {}),
        sortBy: 'displayName',
      })
        .then((result) => {
          if (active) setData(result);
        })
        .catch(() => {
          if (active) setError(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pageNumber, revision, search, token]);

  return (
    <div className="page-stack crm-assets-page">
      <header className="page-header crm-assets-page-header">
        <div>
          <p className="page-eyebrow">{t('crm.assetsPage.eyebrow')}</p>
          <h1>{t('crm.assetsPage.title')}</h1>
          <p>{t('crm.assetsPage.description')}</p>
        </div>
      </header>
      <CrmTabs />

      <section className="crm-assets-register" aria-labelledby="crm-assets-register-title">
        <div className="crm-assets-register-toolbar">
          <div>
            <h2 id="crm-assets-register-title">{t('crm.assetsPage.listTitle')}</h2>
            <p>
              {t('crm.assetsPage.count', {
                count: data?.total ?? 0,
              })}
            </p>
          </div>
          <TextField
            id="crm-assets-customer-search"
            label={t('crm.assetsPage.search')}
            onChange={(event) => {
              setSearch(event.target.value);
              setPageNumber(1);
            }}
            value={search}
          />
        </div>

        {error ? (
          <InlineAlert tone="error">
            <div className="partners-inline-message">
              <span>{t('crm.assetsPage.loadError')}</span>
              <button onClick={() => setRevision((value) => value + 1)} type="button">
                {t('crm.assetsPage.retry')}
              </button>
            </div>
          </InlineAlert>
        ) : null}

        {loading && !data ? (
          <div aria-live="polite" className="crm-assets-loading">
            <span className="loading-spinner" />
          </div>
        ) : null}

        {!error && !loading && data?.items.length === 0 ? (
          <div className="crm-assets-empty">
            <Icon name="customers" size={20} />
            <p>{t('crm.assetsPage.empty')}</p>
          </div>
        ) : null}

        {!error && data?.items.length ? (
          <div aria-busy={loading} className="crm-assets-customer-list">
            {data.items.map((customer) => (
              <article className="crm-assets-customer-row" key={customer.id}>
                <span className="crm-assets-customer-icon" aria-hidden="true">
                  <Icon name="customers" size={17} />
                </span>
                <div className="crm-assets-customer-copy">
                  <strong>{customer.displayName}</strong>
                  <span>
                    {customer.uic
                      ? `${t('crm.assetsPage.partnerReference')}: ${customer.uic}`
                      : (customer.companyRepresentative ?? customer.kind.replace('_', ' '))}
                  </span>
                </div>
                <span
                  className={`crm-assets-customer-status${customer.active ? '' : ' is-inactive'}`}
                >
                  {t(customer.active ? 'crm.assetsPage.active' : 'crm.assetsPage.inactive')}
                </span>
                <Button
                  onClick={() => setSelected(customer)}
                  variant="secondary"
                  aria-label={t('crm.assetsPage.openPartner', { name: customer.displayName })}
                >
                  {t('crm.assetsPage.openTitle')}
                  <Icon name="arrow" size={15} />
                </Button>
              </article>
            ))}
          </div>
        ) : null}

        {(data?.totalPages ?? 0) > 1 ? (
          <footer className="crm-assets-pagination">
            <Button
              disabled={pageNumber <= 1 || loading}
              onClick={() => setPageNumber((value) => value - 1)}
              variant="quiet"
            >
              {t('crm.assetsPage.previous')}
            </Button>
            <span>
              {t('crm.assetsPage.page', {
                page: data?.page ?? pageNumber,
                pages: data?.totalPages ?? 1,
              })}
            </span>
            <Button
              disabled={pageNumber >= (data?.totalPages ?? 1) || loading}
              onClick={() => setPageNumber((value) => value + 1)}
              variant="quiet"
            >
              {t('crm.assetsPage.next')}
            </Button>
          </footer>
        ) : null}
      </section>

      {selected && token ? (
        <CustomerAssetsDrawer
          canDelete={hasPermission('crm', 'delete')}
          canEdit={hasPermission('crm', 'edit')}
          canViewService={hasPermission('erp.service')}
          onClose={() => setSelected(null)}
          partner={selected}
          token={token}
        />
      ) : null}
    </div>
  );
}

function CustomerAssetsDrawer({
  canDelete,
  canEdit,
  canViewService,
  onClose,
  partner,
  token,
}: {
  canDelete: boolean;
  canEdit: boolean;
  canViewService: boolean;
  onClose: () => void;
  partner: PartnerSummary;
  token: string;
}) {
  const { t } = useLocalization();
  const [profile, setProfile] = useState<PartnerProfile | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setError(false);
    void getPartnerProfile(token, partner.id)
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [partner.id, revision, token]);

  return (
    <div className="drawer-layer">
      <button
        aria-label={t('crm.assetsPage.backToCustomers')}
        className="drawer-scrim"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-label={t('crm.assetsPage.openTitle')}
        aria-modal="true"
        className="record-drawer crm-assets-detail-drawer"
        role="dialog"
      >
        <div className="record-drawer-navigation">
          <button
            aria-label={t('crm.assetsPage.backToCustomers')}
            className="panel-back-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="arrow" size={17} />
            {t('crm.assetsPage.backToCustomers')}
          </button>
          <button
            aria-label={t('crm.assetsPage.close')}
            className="drawer-close panel-close-button"
            onClick={onClose}
            type="button"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="crm-assets-detail-heading">
          <span className="crm-assets-customer-icon" aria-hidden="true">
            <Icon name="customers" size={18} />
          </span>
          <div>
            <h2>{partner.displayName}</h2>
            {partner.uic ? (
              <p>
                {t('crm.assetsPage.partnerReference')}: {partner.uic}
              </p>
            ) : null}
          </div>
        </div>
        {error ? (
          <InlineAlert tone="error">
            <div className="partners-inline-message">
              <span>{t('crm.assetsPage.profileError')}</span>
              <button onClick={() => setRevision((value) => value + 1)} type="button">
                {t('crm.assetsPage.retry')}
              </button>
            </div>
          </InlineAlert>
        ) : null}
        {!error && !profile ? (
          <div aria-live="polite" className="crm-assets-loading">
            <span className="loading-spinner" />
            <span>{t('crm.assetsPage.profileLoading')}</span>
          </div>
        ) : null}
        {profile ? (
          <CustomerAssetsPanel
            canDelete={canDelete}
            canEdit={canEdit}
            canViewService={canViewService}
            contacts={profile.contacts}
            partnerId={partner.id}
            token={token}
          />
        ) : null}
      </aside>
    </div>
  );
}
