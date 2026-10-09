import { Button, InlineAlert, Toast } from '@vista/ui';
import type {
  CreateFinancialDocumentLineRequest,
  CreateFinancialDocumentRequest,
  FinancialDocument,
  FinancialDocumentReferenceData,
  FinancialDocumentType,
  VatTreatment,
  SalesResolvedPrice,
} from '@vista/contracts';
import { calculateFinancialDocument } from '@vista/domain';
import {
  Children,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';

import { ApiClientError } from '../api/client';
import {
  cancelFinancialDocument,
  createFinancialDocument,
  getFinancialDocument,
  getFinancialDocumentReferenceData,
  listFinancialDocuments,
  resolveFinancialDocumentPrice,
} from '../api/finance';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { financialDocumentMessages as copy } from '../i18n/legacyMessages';
import {
  formatOperationsCurrency,
  formatOperationsDate,
  useLocalization,
} from '../i18n/LocalizationProvider';
import { useRouter } from '../routing/Router';
import { FinanceTabs } from './FinanceBankPage';
import { ManagedFilesPanel } from './PartnerDocumentsPanel';

const emptyReferences: FinancialDocumentReferenceData = {
  businessTimezone: 'UTC',
  correctionDocuments: [],
  customers: [],
  products: [],
  salesDrafts: [],
  serviceDrafts: [],
  subscriptionDrafts: [],
  scopes: [],
};

interface DraftLine extends CreateFinancialDocumentLineRequest {
  key: string;
  manualPrice?: boolean;
}

export function FinancialDocumentsPage() {
  useLocalization();
  const { hasPermission, session } = useAuth();
  const { location, navigate } = useRouter();
  const token = session?.sessionToken ?? '';
  const data = useFinancialDocuments(token);
  const [creating, setCreating] = useState(false);
  const [serviceWorkOrderId, setServiceWorkOrderId] = useState<string | undefined>();
  const [subscriptionDraftId, setSubscriptionDraftId] = useState<string | undefined>();
  const [selected, setSelected] = useState<FinancialDocument | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | FinancialDocumentType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | FinancialDocument['status']>('all');
  const canCreate = hasPermission('erp.finance', 'create');
  const canEdit = hasPermission('erp.finance', 'edit');
  const canViewSales = hasPermission('erp.sales');
  const visible = data.documents.filter(
    (document) =>
      (typeFilter === 'all' || document.documentType === typeFilter) &&
      (statusFilter === 'all' || document.status === statusFilter),
  );

  useEffect(() => {
    if (data.loading) return;
    const handoff = financialDocumentRouteState(location.state);
    if (!handoff) return;
    if (handoff.financialDocumentId) {
      const document = data.documents.find((item) => item.id === handoff.financialDocumentId);
      if (document) setSelected(document);
      else
        void getFinancialDocument(token, handoff.financialDocumentId)
          .then(setSelected)
          .catch(() => setNotice('The linked Finance draft could not be opened. Try again.'));
    } else if (handoff.serviceWorkOrderId && canCreate) {
      setSubscriptionDraftId(undefined);
      setServiceWorkOrderId(handoff.serviceWorkOrderId);
      setCreating(true);
    } else if (handoff.subscriptionDraftId) {
      const draft = data.references.subscriptionDrafts.find(
        (item) => item.id === handoff.subscriptionDraftId,
      );
      if (draft?.linkedDocumentId) {
        void getFinancialDocument(token, draft.linkedDocumentId)
          .then(setSelected)
          .catch(() => setNotice('The linked Finance draft could not be opened. Try again.'));
      } else if (draft && canCreate) {
        setServiceWorkOrderId(undefined);
        setSubscriptionDraftId(draft.id);
        setCreating(true);
      }
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [
    canCreate,
    data.documents,
    data.references.subscriptionDrafts,
    data.loading,
    location.pathname,
    location.state,
    navigate,
    token,
  ]);

  if (data.loading) return <DocumentState title={copy.loading} />;
  if (data.error)
    return (
      <DocumentState title={copy.loadError}>
        <Button onClick={data.reload} variant="secondary">
          {copy.retry}
        </Button>
      </DocumentState>
    );

  return (
    <div className="page-stack financial-documents-workspace">
      <header className="page-header financial-documents-header">
        <div>
          <p className="page-eyebrow">ERP · Finance</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </div>
        {canCreate ? (
          <Button
            onClick={() => {
              setNotice(null);
              setServiceWorkOrderId(undefined);
              setSubscriptionDraftId(undefined);
              setCreating(true);
            }}
          >
            <Icon name="plus" size={16} /> {copy.addDocument}
          </Button>
        ) : null}
      </header>

      <FinanceTabs />

      <InlineAlert tone="info">{copy.configurationBoundary}</InlineAlert>
      {notice ? (
        <Toast
          durationMs={notice.includes('could not') ? 7000 : 5200}
          onDismiss={() => setNotice(null)}
          tone={notice.includes('could not') ? 'error' : 'success'}
        >
          {notice}
        </Toast>
      ) : null}

      <section aria-label="Document summary" className="financial-document-summary">
        <SummaryMetric
          label="Active drafts"
          value={data.documents.filter((item) => item.status === 'draft').length}
        />
        <SummaryMetric
          label="Invoices"
          value={data.documents.filter((item) => item.documentType === 'invoice').length}
        />
        <SummaryMetric
          label="Proformas"
          value={data.documents.filter((item) => item.documentType === 'proforma').length}
        />
        <SummaryMetric
          label="Correction notes"
          value={data.documents.filter((item) => item.documentType.includes('note')).length}
        />
      </section>

      {data.references.subscriptionDrafts?.length ? (
        <section className="financial-document-register-shell">
          <header className="financial-document-toolbar">
            <div>
              <h2>Subscription billing</h2>
              <p>Review each billing period before preparing its invoice.</p>
            </div>
          </header>
          {data.references.subscriptionDrafts.map((draft) => (
            <article className="subscription-finance-row" key={draft.id}>
              <div>
                <strong>{draft.number}</strong>
                <small>{draft.contractNumber}</small>
              </div>
              <div>
                <strong>{draft.customerName}</strong>
                <small>
                  {formatDate(draft.servicePeriodStart)} / {formatDate(draft.servicePeriodEnd)}
                </small>
              </div>
              <div>
                <small>Net charge</small>
                <strong>{formatMoney(draft.amount, draft.currencyCode)}</strong>
              </div>
              {draft.linkedDocumentId ? (
                <Button
                  variant="quiet"
                  onClick={() => {
                    void getFinancialDocument(token, draft.linkedDocumentId!)
                      .then(setSelected)
                      .catch(() =>
                        setNotice('The linked Finance draft could not be opened. Try again.'),
                      );
                  }}
                >
                  {copy.preview}
                </Button>
              ) : canCreate ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotice(null);
                    setServiceWorkOrderId(undefined);
                    setSubscriptionDraftId(draft.id);
                    setCreating(true);
                  }}
                >
                  Review billing
                </Button>
              ) : (
                <span>Awaiting Finance review</span>
              )}
            </article>
          ))}
        </section>
      ) : null}

      <section className="financial-document-register-shell">
        <header className="financial-document-toolbar">
          <div>
            <h2>Document register</h2>
            <p>{data.documents.length} prepared records</p>
          </div>
          <div className="financial-document-filters">
            <label>
              <span className="sr-only">Document type</span>
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}
              >
                <option value="all">{copy.allTypes}</option>
                {documentTypes.map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              >
                <option value="all">{copy.allStatuses}</option>
                <option value="draft">{copy.draft}</option>
                <option value="cancelled">{copy.cancelled}</option>
              </select>
            </label>
          </div>
        </header>
        {visible.length ? (
          <div className="financial-document-register">
            <div className="financial-document-register-head" aria-hidden="true">
              <span>Document</span>
              <span>Customer</span>
              <span>Date</span>
              <span>Total</span>
              <span>Status</span>
              <span />
            </div>
            {visible.map((document) => (
              <article className="financial-document-register-row" key={document.id}>
                <div className="financial-document-identity">
                  <span>{typeMark(document.documentType)}</span>
                  <div>
                    <strong>{document.number}</strong>
                    <small>{typeLabel(document.documentType)}</small>
                  </div>
                </div>
                <div>
                  <strong>{document.customerSnapshot.name}</strong>
                  <small>{document.businessLocationName}</small>
                </div>
                <div>
                  <strong>{formatDate(document.issueDate)}</strong>
                  <small>Tax event {formatDate(document.taxEventDate)}</small>
                </div>
                <div>
                  <strong>{formatMoney(document.grossTotal, document.currencyCode)}</strong>
                  <small>{formatMoney(document.bgnGrossTotal, 'BGN')}</small>
                </div>
                <DocumentStatus status={document.status} />
                <Button onClick={() => setSelected(document)} variant="quiet">
                  {copy.preview}
                </Button>
              </article>
            ))}
          </div>
        ) : (
          <DocumentState title={copy.emptyTitle}>
            <p>{copy.emptyDescription}</p>
          </DocumentState>
        )}
      </section>

      {creating ? (
        <CreateDocumentDrawer
          onBack={() => setCreating(false)}
          onSaved={(document) => {
            setCreating(false);
            setNotice(copy.created(document.number));
            setSelected(document);
            data.reload();
          }}
          references={data.references}
          {...(serviceWorkOrderId ? { serviceWorkOrderId } : {})}
          {...(subscriptionDraftId ? { subscriptionDraftId } : {})}
          token={token}
        />
      ) : null}
      {selected ? (
        <DocumentPreviewDrawer
          canEdit={canEdit}
          document={selected}
          {...(canViewSales && selected.sourceSalesInvoiceId
            ? {
                onOpenSalesSource: () =>
                  navigate('/modules/erp.sales/shipments', {
                    state: {
                      returnTo: location.pathname,
                      sourceSalesInvoiceId: selected.sourceSalesInvoiceId,
                    },
                  }),
              }
            : {})}
          onBack={() => setSelected(null)}
          onSaved={(document) => {
            setSelected(document);
            setNotice(`${document.number} was cancelled.`);
            data.reload();
          }}
          token={token}
        />
      ) : null}
    </div>
  );
}

function CreateDocumentDrawer({
  onBack,
  onSaved,
  references,
  serviceWorkOrderId,
  subscriptionDraftId,
  token,
}: {
  onBack: () => void;
  onSaved: (document: FinancialDocument) => void;
  references: FinancialDocumentReferenceData;
  serviceWorkOrderId?: string;
  subscriptionDraftId?: string;
  token: string;
}) {
  const firstScope = references.scopes[0];
  const initialServiceDraft = references.serviceDrafts.find(
    (draft) => draft.id === serviceWorkOrderId && !draft.linkedDocumentTypes.includes('invoice'),
  );
  const [documentType, setDocumentType] = useState<FinancialDocumentType>('invoice');
  const [sourceMode, setSourceMode] = useState<'manual' | 'sales' | 'service' | 'subscription'>(
    subscriptionDraftId ? 'subscription' : initialServiceDraft ? 'service' : 'sales',
  );
  const [scopeId, setScopeId] = useState(firstScope?.locationId ?? '');
  const [cashRegisterId, setCashRegisterId] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [customerId, setCustomerId] = useState(references.customers[0]?.id ?? '');
  const [salesDraftId, setSalesDraftId] = useState(references.salesDrafts[0]?.id ?? '');
  const [serviceDraftId, setServiceDraftId] = useState(initialServiceDraft?.id ?? '');
  const [subscriptionId, setSubscriptionId] = useState(subscriptionDraftId ?? '');
  const [correctionId, setCorrectionId] = useState(references.correctionDocuments[0]?.id ?? '');
  const [correctionReason, setCorrectionReason] = useState('');
  const businessDate = today(references.businessTimezone);
  const [issueDate, setIssueDate] = useState(businessDate);
  const [taxEventDate, setTaxEventDate] = useState(businessDate);
  const [dueDate, setDueDate] = useState(daysFromDate(businessDate, 14));
  const [currencyCode, setCurrencyCode] = useState('BGN');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [rateDate, setRateDate] = useState(businessDate);
  const [rateSource, setRateSource] = useState('internal_bgn');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [serviceLines, setServiceLines] = useState<DraftLine[]>(
    initialServiceDraft ? draftLines(initialServiceDraft.lines, 'service') : [],
  );
  const [busy, setBusy] = useState(false);
  const [loadingCorrection, setLoadingCorrection] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<
    Record<string, { loading: boolean; result?: SalesResolvedPrice; error?: boolean }>
  >({});
  const selectedScope = references.scopes.find((scope) => scope.locationId === scopeId);
  const eligibleSalesDrafts = useMemo(
    () =>
      references.salesDrafts.filter((draft) => !draft.linkedDocumentTypes.includes(documentType)),
    [documentType, references.salesDrafts],
  );
  const selectedSalesDraft = eligibleSalesDrafts.find((draft) => draft.id === salesDraftId);
  const eligibleServiceDrafts = useMemo(
    () =>
      references.serviceDrafts.filter((draft) => !draft.linkedDocumentTypes.includes(documentType)),
    [documentType, references.serviceDrafts],
  );
  const selectedServiceDraft = eligibleServiceDrafts.find((draft) => draft.id === serviceDraftId);
  const eligibleSubscriptions = (references.subscriptionDrafts ?? []).filter(
    (draft) => !draft.linkedDocumentId,
  );
  const selectedSubscription = eligibleSubscriptions.find((draft) => draft.id === subscriptionId);
  const correction = references.correctionDocuments.find((item) => item.id === correctionId);
  const isCorrection = documentType === 'credit_note' || documentType === 'debit_note';
  const effectiveLines =
    sourceMode === 'sales' && selectedSalesDraft
      ? selectedSalesDraft.lines.map((line, index) => ({ ...line, key: `source-${index}` }))
      : sourceMode === 'service' || sourceMode === 'subscription'
        ? serviceLines
        : lines;
  const totals = calculatePreview(effectiveLines, currencyCode === 'BGN' ? '1' : exchangeRate);
  const priceLookupKey = JSON.stringify(
    sourceMode === 'manual' && !isCorrection
      ? lines
          .filter((line) => line.productId)
          .map((line) => ({ key: line.key, productId: line.productId! }))
      : [],
  );

  useEffect(() => {
    let active = true;
    const lookups = JSON.parse(priceLookupKey) as Array<{ key: string; productId: string }>;
    setPrices(Object.fromEntries(lookups.map((line) => [line.key, { loading: true }])));
    if (!lookups.length) return;
    setLines((current) =>
      current.map((line) =>
        line.productId && !line.manualPrice ? { ...line, unitPrice: '' } : line,
      ),
    );
    for (const lookup of lookups) {
      void resolveFinancialDocumentPrice(token, {
        asOf: issueDate,
        currencyCode,
        customerPartnerId: customerId,
        productId: lookup.productId,
      })
        .then((result) => {
          if (!active) return;
          setPrices((current) => ({ ...current, [lookup.key]: { loading: false, result } }));
          setLines((current) =>
            current.map((line) =>
              line.key === lookup.key && !line.manualPrice && line.productId === lookup.productId
                ? { ...line, unitPrice: result.matched ? (result.unitPrice ?? '') : '' }
                : line,
            ),
          );
        })
        .catch(() => {
          if (active)
            setPrices((current) => ({ ...current, [lookup.key]: { loading: false, error: true } }));
        });
    }
    return () => {
      active = false;
    };
  }, [currencyCode, customerId, issueDate, priceLookupKey, token]);

  useEffect(() => {
    if (sourceMode === 'subscription' && documentType !== 'invoice') setSourceMode('manual');
  }, [documentType, sourceMode]);

  useEffect(() => {
    // A base-currency default is not a captured foreign-currency exchange rate.
    setExchangeRate(currencyCode === 'BGN' ? '1' : '');
    setRateSource(currencyCode === 'BGN' ? 'internal_bgn' : '');
  }, [currencyCode]);

  useEffect(() => {
    if (!isCorrection || !correctionId) {
      setLoadingCorrection(false);
      return;
    }
    let active = true;
    setLoadingCorrection(true);
    setError(null);
    setLines([]);
    void getFinancialDocument(token, correctionId)
      .then((original) => {
        if (!active) return;
        setLines(
          original.lines.map((line) => ({
            key: crypto.randomUUID(),
            description: line.description,
            discountPercent: line.discountPercent,
            ...(line.productId ? { productId: line.productId } : {}),
            quantity: line.quantity,
            unitCode: line.unitCode,
            unitPrice: line.unitPrice,
            vatTreatment: line.vatTreatment,
          })),
        );
      })
      .catch((caught) => {
        if (active)
          setError(errorText(caught, 'The original invoice could not be loaded. Try again.'));
      })
      .finally(() => {
        if (active) setLoadingCorrection(false);
      });
    return () => {
      active = false;
    };
  }, [correctionId, isCorrection, token]);

  useEffect(() => {
    if (isCorrection) {
      setSourceMode('manual');
      if (correction) {
        setCustomerId(correction.customerPartnerId);
        setCurrencyCode(correction.currencyCode);
      }
      return;
    }
    if (sourceMode === 'sales' && selectedSalesDraft) {
      setCustomerId(selectedSalesDraft.customerPartnerId);
      setCurrencyCode(selectedSalesDraft.currencyCode);
    } else if (sourceMode === 'service' && selectedServiceDraft) {
      setCustomerId(selectedServiceDraft.customerPartnerId);
      setCurrencyCode('BGN');
    }
  }, [correction, isCorrection, selectedSalesDraft, selectedServiceDraft, sourceMode]);

  useEffect(() => {
    if (!isCorrection && sourceMode === 'sales' && !selectedSalesDraft)
      setSalesDraftId(eligibleSalesDrafts[0]?.id ?? '');
  }, [eligibleSalesDrafts, isCorrection, selectedSalesDraft, sourceMode]);

  useEffect(() => {
    if (isCorrection || sourceMode !== 'service') return;
    const source =
      selectedServiceDraft ??
      eligibleServiceDrafts.find((draft) => draft.id === serviceWorkOrderId) ??
      eligibleServiceDrafts[0];
    if (!source) {
      setServiceDraftId('');
      setServiceLines([]);
      return;
    }
    if (source.id !== serviceDraftId) setServiceDraftId(source.id);
    setServiceLines(draftLines(source.lines, 'service'));
  }, [
    eligibleServiceDrafts,
    isCorrection,
    selectedServiceDraft,
    serviceDraftId,
    serviceWorkOrderId,
    sourceMode,
  ]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, ...patch, ...(patch.unitPrice !== undefined ? { manualPrice: true } : {}) }
          : line,
      ),
    );
  }

  useEffect(() => {
    if (isCorrection || sourceMode !== 'subscription') return;
    const source =
      selectedSubscription ??
      references.subscriptionDrafts?.find((draft) => !draft.linkedDocumentId);
    if (!source) {
      setSubscriptionId('');
      setServiceLines([]);
      return;
    }
    setSubscriptionId(source.id);
    setCustomerId(source.customerPartnerId);
    setCurrencyCode(source.currencyCode);
    setTaxEventDate(source.billingDate);
    setServiceLines([
      {
        key: source.id,
        description: `${source.number} · ${source.servicePeriodStart} / ${source.servicePeriodEnd}`,
        quantity: '1',
        unitPrice: source.amount,
        unitCode: 'SERVICE',
        discountPercent: '0',
        vatTreatment: 'standard_20',
      },
    ]);
  }, [isCorrection, references.subscriptionDrafts, selectedSubscription, sourceMode]);

  function chooseProduct(key: string, productId: string) {
    const product = references.products.find((item) => item.id === productId);
    setLines((current) =>
      current.map((line) => {
        if (line.key !== key) return line;
        if (product)
          return {
            ...line,
            description: product.name,
            productId,
            unitCode: product.unitCode,
            unitPrice: '',
            manualPrice: false,
          };
        const customLine = { ...line };
        delete customLine.productId;
        return {
          ...customLine,
          description: '',
          unitCode: 'PCS',
          unitPrice: '',
          manualPrice: false,
        };
      }),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loadingCorrection || Object.values(prices).some((price) => price.loading)) return;
    if (!selectedScope) return setError('Select an issuing location.');
    if (sourceMode === 'sales' && !selectedSalesDraft)
      return setError(
        'Choose an unlinked Sales draft, or switch the document source to manual entry.',
      );
    if (sourceMode === 'service' && !selectedServiceDraft)
      return setError('Choose completed Service work, or select another document source.');
    if (sourceMode === 'subscription' && !selectedSubscription)
      return setError('Select a subscription billing record awaiting review.');
    setBusy(true);
    setError(null);
    try {
      const input: CreateFinancialDocumentRequest = {
        businessLocationId: selectedScope.locationId,
        ...(cashRegisterId ? { cashRegisterId } : {}),
        ...(isCorrection
          ? { correctionOfDocumentId: correctionId, correctionReason: correctionReason.trim() }
          : {}),
        currencyCode,
        customerPartnerId: customerId,
        documentType,
        ...(!isCorrection ? { dueDate } : {}),
        exchangeRate,
        issueDate,
        legalEntityId: selectedScope.legalEntityId,
        ...(sourceMode === 'manual'
          ? { lines: lines.map(withoutKey) }
          : sourceMode === 'service' || sourceMode === 'subscription'
            ? { lines: serviceLines.map(withoutKey) }
            : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(operatorId ? { operatorId } : {}),
        rateDate,
        rateSource,
        ...(sourceMode === 'sales' ? { sourceSalesInvoiceId: salesDraftId } : {}),
        ...(sourceMode === 'service' ? { sourceServiceWorkOrderId: serviceDraftId } : {}),
        ...(sourceMode === 'subscription' ? { sourceSubscriptionDraftId: subscriptionId } : {}),
        taxEventDate,
      };
      onSaved(await createFinancialDocument(token, crypto.randomUUID(), input));
    } catch (caught) {
      setError(errorText(caught, copy.createError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DocumentDrawer
      busy={busy}
      onBack={onBack}
      subtitle="Controlled draft preparation"
      title={copy.addDocument}
    >
      <form className="financial-document-form" onSubmit={(event) => void submit(event)}>
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        {!references.scopes.length || !references.customers.length ? (
          <InlineAlert tone="warning">
            An active business location and customer with a billing or registered address are
            required.
          </InlineAlert>
        ) : null}
        <FormSection number="1" title="Document context">
          <div className="financial-document-form-grid">
            <Field label="Document type">
              <select
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value as FinancialDocumentType)}
              >
                {documentTypes.map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
            </Field>
            {!isCorrection ? (
              <Field label={copy.sourceMode}>
                <select
                  value={sourceMode}
                  onChange={(event) => setSourceMode(event.target.value as typeof sourceMode)}
                >
                  <option value="sales">{copy.salesDraft}</option>
                  <option value="service">{copy.serviceDraft}</option>
                  {documentType === 'invoice' ? (
                    <option value="subscription">Subscription billing</option>
                  ) : null}
                  <option value="manual">{copy.manualEntry}</option>
                </select>
              </Field>
            ) : null}
            <Field label={copy.scope}>
              <select
                required
                value={scopeId}
                onChange={(event) => {
                  setScopeId(event.target.value);
                  setCashRegisterId('');
                  setOperatorId('');
                }}
              >
                {references.scopes.map((scope) => (
                  <option key={scope.locationId} value={scope.locationId}>
                    {scope.legalEntityName} · {scope.locationName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.customer}>
              <select
                disabled={sourceMode !== 'manual' || isCorrection}
                required
                value={customerId}
                onChange={(event) => setCustomerId(event.target.value)}
              >
                {references.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </Field>
            {sourceMode === 'sales' && !isCorrection ? (
              <Field label={copy.salesDraft}>
                <select
                  required
                  value={salesDraftId}
                  onChange={(event) => setSalesDraftId(event.target.value)}
                >
                  {eligibleSalesDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.number} · {draft.customerName} ·{' '}
                      {formatMoney(draft.total, draft.currencyCode)}
                    </option>
                  ))}
                </select>
                {!eligibleSalesDrafts.length ? (
                  <small>
                    No unlinked Sales draft is available for this document type. Choose Manual
                    document or cancel the existing draft first.
                  </small>
                ) : null}
              </Field>
            ) : null}
            {sourceMode === 'subscription' && !isCorrection ? (
              <Field label="Subscription billing record" wide>
                <select
                  required
                  value={subscriptionId}
                  onChange={(event) => setSubscriptionId(event.target.value)}
                >
                  {eligibleSubscriptions.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.number} · {draft.customerName}
                    </option>
                  ))}
                </select>
                {!eligibleSubscriptions.length ? (
                  <small>No subscription billing record is awaiting review.</small>
                ) : null}
              </Field>
            ) : null}
            {sourceMode === 'service' && !isCorrection ? (
              <Field label={copy.serviceDraft}>
                <select
                  required
                  value={serviceDraftId}
                  onChange={(event) => setServiceDraftId(event.target.value)}
                >
                  {eligibleServiceDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.number} · {draft.customerName} · {formatMoney(draft.total, 'BGN')}
                    </option>
                  ))}
                </select>
                {!eligibleServiceDrafts.length ? (
                  <small>
                    No completed Service work is ready for this document type. Complete a charged
                    work order or cancel its existing draft first.
                  </small>
                ) : null}
              </Field>
            ) : null}
            {isCorrection ? (
              <>
                <Field label={copy.correctionLink}>
                  <select
                    required
                    value={correctionId}
                    onChange={(event) => setCorrectionId(event.target.value)}
                  >
                    {references.correctionDocuments.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.number} · {item.customerName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={copy.correctionReason} wide>
                  <textarea
                    maxLength={1000}
                    required
                    rows={3}
                    value={correctionReason}
                    onChange={(event) => setCorrectionReason(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field label={copy.register}>
              <select
                value={cashRegisterId}
                onChange={(event) => setCashRegisterId(event.target.value)}
              >
                <option value="">No cash register</option>
                {selectedScope?.cashRegisters.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={copy.operator}>
              <select value={operatorId} onChange={(event) => setOperatorId(event.target.value)}>
                <option value="">No operator</option>
                {selectedScope?.operators.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </FormSection>

        <FormSection number="2" title="Dates and currency">
          <div className="financial-document-form-grid">
            <Field label={copy.documentDate}>
              <input
                required
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </Field>
            <Field label={copy.taxEventDate}>
              <input
                required
                type="date"
                value={taxEventDate}
                onChange={(event) => setTaxEventDate(event.target.value)}
              />
            </Field>
            {!isCorrection ? (
              <Field label={copy.dueDate}>
                <input
                  min={issueDate}
                  required
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </Field>
            ) : null}
            <Field label={copy.currency}>
              <input
                disabled={sourceMode === 'service' || sourceMode === 'subscription'}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                required
                value={currencyCode}
                onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
              />
            </Field>
            {currencyCode !== 'BGN' ? (
              <>
                <Field label={copy.exchangeRate}>
                  <input
                    min="0.00000001"
                    required
                    step="0.00000001"
                    type="number"
                    value={exchangeRate}
                    onChange={(event) => setExchangeRate(event.target.value)}
                  />
                </Field>
                <Field label={copy.rateDate}>
                  <input
                    required
                    type="date"
                    value={rateDate}
                    onChange={(event) => setRateDate(event.target.value)}
                  />
                </Field>
                <Field label={copy.rateSource} wide>
                  <input
                    maxLength={120}
                    required
                    value={rateSource}
                    onChange={(event) => setRateSource(event.target.value)}
                  />
                  <small>{copy.foreignRateHint}</small>
                </Field>
              </>
            ) : null}
          </div>
        </FormSection>

        <FormSection number="3" title={copy.lines}>
          {sourceMode === 'sales' && !isCorrection ? (
            <div className="financial-source-lines">
              {effectiveLines.map((line) => (
                <LineSummary key={line.key} line={line} />
              ))}
            </div>
          ) : (sourceMode === 'service' || sourceMode === 'subscription') && !isCorrection ? (
            <div className="financial-service-source">
              <InlineAlert tone="info">
                {sourceMode === 'subscription'
                  ? 'The charge comes from the saved billing period. Review its VAT treatment before preparing the draft.'
                  : 'Labour, parts, and transport come from the completed work order. Review the VAT treatment for every line before preparing the draft.'}
              </InlineAlert>
              <div className="financial-line-editor">
                {serviceLines.map((line) => (
                  <div className="financial-line-card is-source-locked" key={line.key}>
                    <header>
                      <div>
                        <strong>{line.description}</strong>
                        <span>
                          {line.quantity} {line.unitCode} ×{' '}
                          {formatMoney(line.unitPrice, currencyCode)}
                        </span>
                      </div>
                      <span className="financial-source-lock">
                        <Icon name="check" size={14} />{' '}
                        {sourceMode === 'subscription' ? 'Subscription charge' : 'Service charge'}
                      </span>
                    </header>
                    <div className="financial-line-grid is-tax-review">
                      <Field label={copy.vatTreatment} wide>
                        <select
                          value={line.vatTreatment}
                          onChange={(event) =>
                            setServiceLines((current) =>
                              current.map((item) =>
                                item.key === line.key
                                  ? {
                                      ...item,
                                      vatTreatment: event.target.value as VatTreatment,
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          {vatTreatments.map((treatment) => (
                            <option key={treatment} value={treatment}>
                              {vatLabel(treatment)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {line.vatTreatment === 'ica' ? (
                        <Field label={copy.vatRate} wide>
                          <input
                            max="100"
                            min="0"
                            required
                            step="0.0001"
                            type="number"
                            value={line.vatRate ?? '20'}
                            onChange={(event) =>
                              setServiceLines((current) =>
                                current.map((item) =>
                                  item.key === line.key
                                    ? { ...item, vatRate: event.target.value }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="financial-line-editor">
              {lines.map((line, index) => (
                <div className="financial-line-card" key={line.key}>
                  <header>
                    <strong>Line {index + 1}</strong>
                    {lines.length > 1 ? (
                      <button
                        aria-label={copy.removeLine}
                        onClick={() =>
                          setLines((items) => items.filter((item) => item.key !== line.key))
                        }
                        type="button"
                      >
                        <Icon name="close" size={15} />
                      </button>
                    ) : null}
                  </header>
                  <div className="financial-line-grid">
                    <Field label={copy.product} wide>
                      <select
                        value={line.productId ?? ''}
                        onChange={(event) => chooseProduct(line.key, event.target.value)}
                      >
                        <option value="">Custom service or item</option>
                        {references.products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.code} · {product.name}
                          </option>
                        ))}
                      </select>
                      {!line.productId ? (
                        <input
                          maxLength={500}
                          placeholder="Description"
                          required
                          value={line.description}
                          onChange={(event) =>
                            updateLine(line.key, { description: event.target.value })
                          }
                        />
                      ) : null}
                    </Field>
                    <Field label={copy.quantity}>
                      <input
                        min="0.0001"
                        required
                        step="0.0001"
                        type="number"
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                      />
                    </Field>
                    <Field label={copy.unit}>
                      <input
                        maxLength={30}
                        required
                        value={line.unitCode}
                        onChange={(event) =>
                          updateLine(line.key, { unitCode: event.target.value.toUpperCase() })
                        }
                      />
                    </Field>
                    <Field label={copy.unitPrice}>
                      <input
                        min="0"
                        required
                        step="0.0001"
                        type="number"
                        value={line.unitPrice}
                        onChange={(event) =>
                          updateLine(line.key, { unitPrice: event.target.value })
                        }
                      />
                      {sourceMode === 'manual' && !isCorrection && line.productId ? (
                        <div className="financial-price-hint" aria-live="polite">
                          {prices[line.key]?.loading ? (
                            <small>Finding customer price…</small>
                          ) : prices[line.key]?.result?.matched ? (
                            <>
                              <small>{prices[line.key]?.result?.priceListName}</small>
                              {line.manualPrice ? (
                                <Button
                                  type="button"
                                  variant="quiet"
                                  onClick={() => {
                                    const price = prices[line.key]?.result?.unitPrice;
                                    if (price)
                                      setLines((current) =>
                                        current.map((item) =>
                                          item.key === line.key
                                            ? { ...item, unitPrice: price, manualPrice: false }
                                            : item,
                                        ),
                                      );
                                  }}
                                >
                                  Use customer price
                                </Button>
                              ) : null}
                            </>
                          ) : (
                            <small>
                              {prices[line.key]?.error
                                ? 'Customer price could not be loaded. Enter a price or try again.'
                                : 'No price matches this customer, date and currency. Enter the unit price.'}
                            </small>
                          )}
                        </div>
                      ) : null}
                    </Field>
                    <Field label={copy.discount}>
                      <input
                        max="100"
                        min="0"
                        required
                        step="0.0001"
                        type="number"
                        value={line.discountPercent}
                        onChange={(event) =>
                          updateLine(line.key, { discountPercent: event.target.value })
                        }
                      />
                    </Field>
                    <Field label={copy.vatTreatment}>
                      <select
                        value={line.vatTreatment}
                        onChange={(event) =>
                          updateLine(line.key, { vatTreatment: event.target.value as VatTreatment })
                        }
                      >
                        {vatTreatments.map((treatment) => (
                          <option key={treatment} value={treatment}>
                            {vatLabel(treatment)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {line.vatTreatment === 'ica' ? (
                      <Field label={copy.vatRate}>
                        <input
                          max="100"
                          min="0"
                          required
                          step="0.0001"
                          type="number"
                          value={line.vatRate ?? '20'}
                          onChange={(event) =>
                            updateLine(line.key, { vatRate: event.target.value })
                          }
                        />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ))}
              <Button
                onClick={() => setLines((current) => [...current, emptyLine()])}
                type="button"
                variant="secondary"
              >
                <Icon name="plus" size={14} /> {copy.addLine}
              </Button>
            </div>
          )}
          {totals ? <TotalsPreview currencyCode={currencyCode} totals={totals} /> : null}
        </FormSection>

        <FormSection number="4" title={copy.notes}>
          <Field label="Preparation note">
            <textarea
              maxLength={2000}
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Field>
        </FormSection>
        <div className="financial-document-form-actions">
          <Button disabled={busy} onClick={onBack} type="button" variant="secondary">
            {copy.close}
          </Button>
          <Button
            busy={busy}
            disabled={
              loadingCorrection ||
              Object.values(prices).some((price) => price.loading) ||
              !effectiveLines.length ||
              !references.scopes.length ||
              !references.customers.length ||
              (sourceMode === 'sales' && !selectedSalesDraft) ||
              (sourceMode === 'service' && !selectedServiceDraft) ||
              (sourceMode === 'subscription' &&
                (!selectedSubscription || documentType !== 'invoice'))
            }
            type="submit"
          >
            {copy.create}
          </Button>
        </div>
      </form>
    </DocumentDrawer>
  );
}

function DocumentPreviewDrawer({
  canEdit,
  document,
  onOpenSalesSource,
  onBack,
  onSaved,
  token,
}: {
  canEdit: boolean;
  document: FinancialDocument;
  onOpenSalesSource?: () => void;
  onBack: () => void;
  onSaved: (document: FinancialDocument) => void;
  token: string;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    if (!reason.trim()) return setError('Enter a reason before cancelling the draft.');
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await cancelFinancialDocument(token, document.id, crypto.randomUUID(), {
          cancellationReason: reason.trim(),
          expectedVersion: document.version,
        }),
      );
    } catch (caught) {
      setError(errorText(caught, 'The draft could not be cancelled.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DocumentDrawer
      busy={busy}
      onBack={onBack}
      subtitle={typeLabel(document.documentType)}
      title={document.number}
    >
      <div className="financial-document-preview">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
        <section className="financial-document-preview-hero">
          <div>
            <DocumentStatus status={document.status} />
            <h3>{formatMoney(document.grossTotal, document.currencyCode)}</h3>
            <p>
              {document.customerSnapshot.name} · {formatDate(document.issueDate)}
            </p>
          </div>
          <div>
            <span>Draft reference</span>
            <strong>No official number allocated</strong>
          </div>
        </section>
        <section className="financial-document-preview-section">
          <header>
            <h3>Document context</h3>
          </header>
          <dl className="financial-document-context">
            <Info label="Type" value={typeLabel(document.documentType)} />
            <Info label="Tax event" value={formatDate(document.taxEventDate)} />
            <Info
              label="Due date"
              value={document.dueDate ? formatDate(document.dueDate) : 'Not applicable'}
            />
            <Info
              label="Issuing location"
              value={`${document.branchName} · ${document.businessLocationName}`}
            />
            <Info
              label="Register / operator"
              value={
                [document.cashRegisterName, document.operatorName].filter(Boolean).join(' · ') ||
                'Not assigned'
              }
            />
            <Info
              label="Currency snapshot"
              value={`${document.currencyCode} · ${document.exchangeRate} BGN · ${formatDate(document.rateDate)}`}
            />
          </dl>
        </section>
        <section className="financial-party-grid">
          <PartyCard label={copy.issuerSnapshot} party={document.issuerSnapshot} />
          <PartyCard label={copy.customerSnapshot} party={document.customerSnapshot} />
        </section>
        <section className="financial-document-preview-section">
          <header>
            <h3>{copy.lines}</h3>
            <span>{document.lines.length}</span>
          </header>
          <div className="financial-preview-lines">
            {document.lines.map((line) => (
              <div key={line.id}>
                <div>
                  <strong>
                    {line.lineNumber}. {line.description}
                  </strong>
                  <span>
                    {line.quantity} {line.unitCode} ×{' '}
                    {formatMoney(line.unitPrice, document.currencyCode)}
                    {Number(line.discountPercent) ? ` · ${line.discountPercent}% discount` : ''}
                  </span>
                </div>
                <div>
                  <strong>{formatMoney(line.grossTotal, document.currencyCode)}</strong>
                  <span>
                    {vatLabel(line.vatTreatment)} · {line.vatRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="financial-document-preview-section">
          <header>
            <h3>VAT summary</h3>
          </header>
          <div className="financial-vat-summary">
            {document.vatSummary.map((item) => (
              <div key={`${item.vatTreatment}-${item.vatRate}`}>
                <span>
                  {vatLabel(item.vatTreatment)} ({item.vatRate}%)
                </span>
                <span>{formatMoney(item.netTotal, document.currencyCode)}</span>
                <strong>{formatMoney(item.vatAmount, document.currencyCode)}</strong>
              </div>
            ))}
          </div>
          <div className="financial-preview-total">
            <span>Net {formatMoney(document.netTotal, document.currencyCode)}</span>
            <span>VAT {formatMoney(document.vatTotal, document.currencyCode)}</span>
            <strong>
              {copy.total} {formatMoney(document.grossTotal, document.currencyCode)}
            </strong>
          </div>
        </section>
        <section className="financial-document-preview-section">
          <header>
            <h3>{copy.bgnEquivalent}</h3>
          </header>
          <dl className="financial-document-context">
            <Info label="Net in BGN" value={formatMoney(document.bgnNetTotal, 'BGN')} />
            <Info label="VAT in BGN" value={formatMoney(document.bgnVatTotal, 'BGN')} />
            <Info label="Total in BGN" value={formatMoney(document.bgnGrossTotal, 'BGN')} />
            <Info label="Rate source" value={document.rateSource} />
          </dl>
        </section>
        {document.sourceSalesInvoiceNumber ||
        document.sourcePosSaleNumber ||
        document.sourceServiceWorkOrderNumber ||
        document.sourceSubscriptionDraftNumber ||
        document.correctionOf ? (
          <section className="financial-document-preview-section">
            <header>
              <h3>{copy.originalSource}</h3>
            </header>
            {document.sourceSalesInvoiceNumber ? (
              <div className="financial-document-source-link">
                <p>
                  Prepared from Sales draft <strong>{document.sourceSalesInvoiceNumber}</strong>.
                </p>
                {onOpenSalesSource ? (
                  <Button onClick={onOpenSalesSource} variant="quiet">
                    Open in Sales
                  </Button>
                ) : null}
              </div>
            ) : null}
            {document.sourceSubscriptionDraftNumber ? (
              <p>
                <span>Subscription billing</span> ·{' '}
                <strong>{document.sourceSubscriptionDraftNumber}</strong>
              </p>
            ) : null}
            {document.sourcePosSaleNumber ? (
              <p>
                Prepared from POS sale <strong>{document.sourcePosSaleNumber}</strong>
                {document.sourceFiscalReceiptNumber ? (
                  <>
                    {' '}
                    · receipt <strong>{document.sourceFiscalReceiptNumber}</strong>
                  </>
                ) : null}
                .
              </p>
            ) : null}
            {document.sourceServiceWorkOrderNumber ? (
              <p>
                Prepared from completed Service work{' '}
                <strong>{document.sourceServiceWorkOrderNumber}</strong>.
              </p>
            ) : null}
            {document.correctionOf ? (
              <p>
                Corrects invoice draft <strong>{document.correctionOf.number}</strong>:{' '}
                {document.correctionReason}
              </p>
            ) : null}
          </section>
        ) : null}
        {document.notes ? (
          <section className="financial-document-preview-section">
            <header>
              <h3>{copy.notes}</h3>
            </header>
            <p>{document.notes}</p>
          </section>
        ) : null}
        <ManagedFilesPanel
          key={document.id}
          canEdit={canEdit}
          copy={copy.attachments}
          parentId={document.id}
          parentType="financial_document"
          token={token}
        />
        {document.cancellationReason ? (
          <InlineAlert tone="warning">Cancelled: {document.cancellationReason}</InlineAlert>
        ) : null}
        {canEdit && document.status === 'draft' ? (
          <section className="financial-document-cancel">
            {cancelling ? (
              <>
                <Field label={copy.cancelPrompt}>
                  <textarea
                    autoFocus
                    maxLength={1000}
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
                <div>
                  <Button disabled={busy} onClick={() => setCancelling(false)} variant="secondary">
                    Keep draft
                  </Button>
                  <Button busy={busy} onClick={() => void cancel()} variant="danger">
                    {copy.saveCancellation}
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={() => setCancelling(true)} variant="quiet">
                {copy.cancel}
              </Button>
            )}
          </section>
        ) : null}
      </div>
    </DocumentDrawer>
  );
}

function DocumentDrawer({
  busy,
  children,
  onBack,
  subtitle,
  title,
}: {
  busy: boolean;
  children: ReactNode;
  onBack: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="security-drawer-layer">
      <button
        aria-label={copy.back}
        className="security-drawer-scrim"
        disabled={busy}
        onClick={onBack}
        type="button"
      />
      <aside
        aria-label={title}
        aria-modal="true"
        className="security-drawer is-wide financial-document-drawer"
        role="dialog"
      >
        <header className="panel-drawer-header financial-document-drawer-header">
          <button
            aria-label={copy.back}
            className="panel-back-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="arrow" size={17} /> Back
          </button>
          <button
            aria-label={copy.close}
            className="panel-close-button"
            disabled={busy}
            onClick={onBack}
            type="button"
          >
            <Icon name="close" />
          </button>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
        </header>
        <div className="security-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

function FormSection({
  children,
  number,
  title,
}: {
  children: ReactNode;
  number: string;
  title: string;
}) {
  return (
    <section className="financial-document-form-section">
      <header>
        <span>{number}</span>
        <h3>{title}</h3>
      </header>
      {children}
    </section>
  );
}
function Field({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  const labelId = useId();
  return (
    <label className={wide ? 'financial-document-field is-wide' : 'financial-document-field'}>
      <span id={labelId}>{label}</span>
      {Children.map(children, (child) =>
        isValidElement(child) && ['input', 'select', 'textarea'].includes(String(child.type))
          ? cloneElement(child as ReactElement<{ 'aria-labelledby'?: string }>, {
              'aria-labelledby': labelId,
            })
          : child,
      )}
    </label>
  );
}
function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function DocumentStatus({ status }: { status: FinancialDocument['status'] }) {
  return (
    <span className={`financial-document-status is-${status}`}>
      {status === 'draft' ? copy.draft : copy.cancelled}
    </span>
  );
}
function DocumentState({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <section className="finance-state">
      <Icon name="finance" size={24} />
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
function PartyCard({
  label,
  party,
}: {
  label: string;
  party: FinancialDocument['issuerSnapshot'];
}) {
  return (
    <section className="financial-party-card">
      <span>{label}</span>
      <h3>{party.name}</h3>
      <p>{party.address}</p>
      <dl>
        <Info label="UIC" value={party.uic ?? 'Not recorded'} />
        <Info label="VAT number" value={party.vatNumber ?? 'Not recorded'} />
      </dl>
    </section>
  );
}
function LineSummary({ line }: { line: DraftLine }) {
  return (
    <div>
      <div>
        <strong>{line.description}</strong>
        <span>
          {line.quantity} {line.unitCode} × {line.unitPrice}
        </span>
      </div>
      <span>{vatLabel(line.vatTreatment)}</span>
    </div>
  );
}
function TotalsPreview({
  currencyCode,
  totals,
}: {
  currencyCode: string;
  totals: ReturnType<typeof calculateFinancialDocument>;
}) {
  return (
    <div className="financial-totals-preview">
      <div>
        <span>{copy.net}</span>
        <strong>{formatMoney(totals.netTotal, currencyCode)}</strong>
      </div>
      <div>
        <span>{copy.vat}</span>
        <strong>{formatMoney(totals.vatTotal, currencyCode)}</strong>
      </div>
      <div>
        <span>{copy.total}</span>
        <strong>{formatMoney(totals.grossTotal, currencyCode)}</strong>
      </div>
    </div>
  );
}

function useFinancialDocuments(token: string) {
  const [documents, setDocuments] = useState<FinancialDocument[]>([]);
  const [references, setReferences] = useState<FinancialDocumentReferenceData>(emptyReferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoading(true);
    setError(false);
    void Promise.all([listFinancialDocuments(token), getFinancialDocumentReferenceData(token)])
      .then(([page, nextReferences]) => {
        if (!active) return;
        setDocuments(page.items);
        setReferences(nextReferences);
      })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [revision, token]);
  return useMemo(
    () => ({ documents, error, loading, references, reload }),
    [documents, error, loading, references, reload],
  );
}

const documentTypes: FinancialDocumentType[] = ['invoice', 'proforma', 'credit_note', 'debit_note'];
const vatTreatments: VatTreatment[] = ['standard_20', 'reduced_9', 'zero', 'exempt', 'ica'];
function typeLabel(type: FinancialDocumentType) {
  return {
    credit_note: copy.creditNote,
    debit_note: copy.debitNote,
    invoice: copy.invoice,
    proforma: copy.proforma,
  }[type];
}
function typeMark(type: FinancialDocumentType) {
  return { credit_note: 'CN', debit_note: 'DN', invoice: 'IN', proforma: 'PF' }[type];
}
function vatLabel(treatment: VatTreatment) {
  return {
    exempt: 'Exempt',
    ica: 'Intra-community acquisition',
    reduced_9: 'Reduced 9%',
    standard_20: 'Standard 20%',
    zero: 'Zero-rated',
  }[treatment];
}
function emptyLine(): DraftLine {
  return {
    description: '',
    discountPercent: '0',
    key: crypto.randomUUID(),
    quantity: '1',
    unitCode: 'PCS',
    unitPrice: '0',
    vatTreatment: 'standard_20',
  };
}
function draftLines(
  lines: FinancialDocumentReferenceData['serviceDrafts'][number]['lines'],
  prefix: string,
): DraftLine[] {
  return lines.map((line, index) => ({ ...line, key: `${prefix}-${index}` }));
}

function financialDocumentRouteState(
  state: unknown,
):
  | { financialDocumentId?: string; serviceWorkOrderId?: string; subscriptionDraftId?: string }
  | undefined {
  if (!state || typeof state !== 'object') return undefined;
  const candidate = state as Record<string, unknown>;
  const financialDocumentId =
    typeof candidate.financialDocumentId === 'string' ? candidate.financialDocumentId : undefined;
  const serviceWorkOrderId =
    typeof candidate.serviceWorkOrderId === 'string' ? candidate.serviceWorkOrderId : undefined;
  const subscriptionDraftId =
    typeof candidate.subscriptionDraftId === 'string' ? candidate.subscriptionDraftId : undefined;
  return financialDocumentId || serviceWorkOrderId || subscriptionDraftId
    ? {
        ...(financialDocumentId ? { financialDocumentId } : {}),
        ...(serviceWorkOrderId ? { serviceWorkOrderId } : {}),
        ...(subscriptionDraftId ? { subscriptionDraftId } : {}),
      }
    : undefined;
}
function withoutKey(line: DraftLine): CreateFinancialDocumentLineRequest {
  return {
    description: line.description,
    discountPercent: line.discountPercent,
    ...(line.productId ? { productId: line.productId } : {}),
    quantity: line.quantity,
    unitCode: line.unitCode,
    unitPrice: line.unitPrice,
    ...(line.vatRate ? { vatRate: line.vatRate } : {}),
    vatTreatment: line.vatTreatment,
  };
}
function calculatePreview(lines: DraftLine[], rate: string) {
  try {
    return calculateFinancialDocument(lines, rate || '0');
  } catch {
    return null;
  }
}
function today(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function daysFromDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function formatDate(value: string) {
  return formatOperationsDate(new Date(`${value}T00:00:00Z`), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}
function formatMoney(value: string, currencyCode: string) {
  try {
    return formatOperationsCurrency(value, currencyCode);
  } catch {
    return `${value} ${currencyCode}`;
  }
}
function errorText(error: unknown, fallback: string) {
  if (!(error instanceof ApiClientError)) return fallback;
  const detail = error.details[0]?.message;
  return detail ? friendlyValidationDetail(detail) : error.message;
}

function friendlyValidationDetail(message: string) {
  const fieldLabels: Record<string, string> = {
    businessLocationId: 'Issuing location',
    cashRegisterId: 'Cash register',
    correctionOfDocumentId: 'Original document',
    correctionReason: 'Correction reason',
    currencyCode: 'Currency',
    customerPartnerId: 'Customer',
    documentType: 'Document type',
    dueDate: 'Due date',
    exchangeRate: 'Exchange rate',
    issueDate: 'Document date',
    legalEntityId: 'Issuing company',
    operatorId: 'Operator',
    rateDate: 'Rate date',
    rateSource: 'Rate source',
    sourceSalesInvoiceId: 'Prepared Sales draft',
    taxEventDate: 'Tax-event date',
  };
  for (const [field, label] of Object.entries(fieldLabels)) {
    if (message.includes(field)) return message.replace(field, label);
  }
  return message;
}
