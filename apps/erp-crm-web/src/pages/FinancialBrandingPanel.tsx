import { Button, Toast } from '@vista/ui';
import type {
  FinancialBrandingAsset,
  FinancialBrandingSettings,
  FinancialDocumentReferenceData,
  SaveFinancialBrandingRequest,
} from '@vista/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiClientError } from '../api/client';
import { getFinancialBranding, saveFinancialBranding } from '../api/financial-branding';
import { readManagedFileBlob, uploadManagedFile } from '../api/files';
import { useAuth } from '../auth/AuthProvider';
import { useLocalization } from '../i18n/LocalizationProvider';
import { DocumentDrawer } from './FinancialDocumentDrawer';
import { financialBrandingMessages } from './financial-branding.messages';

type Copy = ReturnType<typeof financialBrandingMessages>;
export function FinancialBrandingPanel({
  references,
  token,
  onBack,
  onSaved,
}: {
  references: FinancialDocumentReferenceData;
  token: string;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { locale } = useLocalization();
  const copy = financialBrandingMessages(locale);
  const { hasPermission } = useAuth();
  const companies = [
    ...new Map(
      references.scopes.map((scope) => [
        scope.legalEntityId,
        { id: scope.legalEntityId, name: scope.legalEntityName },
      ]),
    ).values(),
  ];
  const [id, setId] = useState(companies[0]?.id ?? '');
  const [settings, setSettings] = useState<FinancialBrandingSettings>();
  const [revision, refresh] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!id) return;
    let active = true;
    setSettings(undefined);
    setError('');
    void getFinancialBranding(token, id)
      .then((result) => {
        if (active) setSettings(result);
      })
      .catch(() => {
        if (active) setError(copy.loadError);
      });
    return () => {
      active = false;
    };
  }, [id, token, revision, copy.loadError]);
  return (
    <DocumentDrawer
      busy={busy}
      backLabel={copy.back}
      className="financial-branding-drawer"
      title={copy.title}
      subtitle={copy.description}
      onBack={onBack}
    >
      {notice ? (
        <Toast tone="success" onDismiss={() => setNotice('')}>
          {notice}
        </Toast>
      ) : null}
      {!companies.length ? (
        <p>{copy.empty}</p>
      ) : (
        <>
          <label className="financial-document-field branding-company">
            <span>{copy.company}</span>
            <select
              aria-label={copy.company}
              value={id}
              disabled={busy}
              onChange={(event) => setId(event.target.value)}
            >
              {companies.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          {error ? (
            <div role="alert">
              <p>{error}</p>
              <Button variant="secondary" onClick={() => refresh((value) => value + 1)}>
                {copy.retry}
              </Button>
            </div>
          ) : !settings ? (
            <p role="status">{copy.loading}</p>
          ) : (
            <BrandingForm
              key={`${id}:${settings.version}`}
              settings={settings}
              token={token}
              copy={copy}
              canEdit={hasPermission('erp.finance', 'edit')}
              busy={busy}
              setBusy={setBusy}
              onBack={onBack}
              onNotice={setNotice}
              onSaved={(result) => {
                setSettings(result);
                setNotice(copy.saved);
                onSaved();
              }}
            />
          )}
        </>
      )}
    </DocumentDrawer>
  );
}

function BrandingForm({
  settings,
  token,
  copy,
  canEdit,
  busy,
  setBusy,
  onBack,
  onSaved,
  onNotice,
}: {
  settings: FinancialBrandingSettings;
  token: string;
  copy: Copy;
  canEdit: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onBack: () => void;
  onSaved: (settings: FinancialBrandingSettings) => void;
  onNotice: (text: string) => void;
}) {
  const [logo, setLogo] = useState(settings.logo);
  const [signature, setSignature] = useState(settings.signature);
  const [name, setName] = useState(settings.signatoryName ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<{ body: string; value: string } | undefined>(undefined);
  const [pendingLogo, setPendingLogo] = useState(false);
  const [pendingSignature, setPendingSignature] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !canEdit || pendingLogo || pendingSignature) return;
    if (signature && (!name.trim() || !confirmed)) {
      setError(copy.signatureRequired);
      return;
    }
    const input: SaveFinancialBrandingRequest = {
      expectedVersion: settings.version,
      ...(logo ? { logoFileId: logo.id } : {}),
      ...(signature
        ? {
            signatureFileId: signature.id,
            signatoryName: name.trim(),
            signatureConfirmed: confirmed,
          }
        : {}),
    };
    const body = JSON.stringify(input);
    if (key.current?.body !== body) key.current = { body, value: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      onSaved(await saveFinancialBranding(token, settings.legalEntityId, input, key.current.value));
    } catch (cause) {
      setError(
        cause instanceof ApiClientError && cause.code === 'FINANCE_BRANDING_VERSION_CONFLICT'
          ? copy.stale
          : copy.saveError,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="financial-document-form branding-form" onSubmit={(event) => void save(event)}>
      <div className="branding-scroll">
        <p className="branding-hint">{copy.applies}</p>
        {!canEdit ? <p className="branding-hint">{copy.readOnly}</p> : null}
        {error ? (
          <p className="recurring-warning" role="alert">
            {error}
          </p>
        ) : null}
        <ImageField
          title={copy.logo}
          asset={logo}
          onChanged={setLogo}
          token={token}
          companyId={settings.legalEntityId}
          canEdit={canEdit}
          busy={busy}
          setBusy={setBusy}
          copy={copy}
          onNotice={onNotice}
          onPending={setPendingLogo}
        />
        <ImageField
          title={copy.signature}
          asset={signature}
          onChanged={(value) => {
            setSignature(value);
            setConfirmed(false);
            if (!value) setName('');
          }}
          token={token}
          companyId={settings.legalEntityId}
          canEdit={canEdit}
          busy={busy}
          setBusy={setBusy}
          copy={copy}
          onNotice={onNotice}
          onPending={setPendingSignature}
        />
        <p className="branding-hint">{copy.signatureHelp}</p>
        {signature ? (
          <section className="financial-document-form-section">
            <label className="financial-document-field">
              <span>{copy.name}</span>
              <input
                aria-label={copy.name}
                disabled={!canEdit || busy}
                maxLength={120}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {canEdit ? (
              <label className="recurring-checkbox">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>{copy.confirmation}</span>
              </label>
            ) : null}
          </section>
        ) : null}
      </div>
      <div className="financial-document-form-actions">
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          {copy.back}
        </Button>
        {canEdit ? (
          <Button
            type="submit"
            disabled={busy || pendingLogo || pendingSignature || (Boolean(signature) && !confirmed)}
          >
            {busy ? copy.saving : copy.save}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ImageField({
  title,
  asset,
  onChanged,
  token,
  companyId,
  canEdit,
  busy,
  setBusy,
  copy,
  onNotice,
  onPending,
}: {
  title: string;
  asset: FinancialBrandingAsset | undefined;
  onChanged: (asset: FinancialBrandingAsset | undefined) => void;
  token: string;
  companyId: string;
  canEdit: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  copy: Copy;
  onNotice: (value: string) => void;
  onPending: (value: boolean) => void;
}) {
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const uploadKey = useRef<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    let objectUrl = '';
    setUrl('');
    setError('');
    if (asset)
      void readManagedFileBlob(token, asset.id)
        .then((blob) => {
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
          }
        })
        .catch(() => {
          if (active) setError(copy.previewError);
        });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.id, token, copy.previewError]);
  async function upload() {
    if (!file) {
      setError(copy.fileRequired);
      return;
    }
    if (file.size > 524288 || !['image/png', 'image/jpeg'].includes(file.type)) {
      setError(copy.invalid);
      return;
    }
    setBusy(true);
    setError('');
    uploadKey.current ??= crypto.randomUUID();
    try {
      const result = await uploadManagedFile(
        token,
        'financial_branding',
        companyId,
        uploadKey.current,
        file,
      );
      onChanged({
        id: result.id,
        fileName: result.originalName,
        byteSize: result.byteSize,
        mediaType: result.mediaType,
        checksumSha256: result.checksumSha256,
      });
      setFile(undefined);
      onPending(false);
      if (fileInput.current) fileInput.current.value = '';
      uploadKey.current = undefined;
      onNotice(copy.uploaded);
    } catch (cause) {
      setError(
        cause instanceof ApiClientError && cause.status === 400 ? copy.invalid : copy.uploadError,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="financial-document-form-section branding-image-field" aria-label={title}>
      <header>
        <h3>{title}</h3>
        {(asset || file) && canEdit ? (
          <Button
            variant="quiet"
            disabled={busy}
            onClick={() => {
              onChanged(undefined);
              setFile(undefined);
              onPending(false);
              if (fileInput.current) fileInput.current.value = '';
              setError('');
            }}
          >
            {copy.remove}
          </Button>
        ) : null}
      </header>
      <div className="branding-image-preview">
        {url ? <img src={url} alt={title} /> : <span>{asset ? asset.fileName : copy.notSet}</span>}
      </div>
      {asset ? <small className="branding-file-name">{asset.fileName}</small> : null}
      {canEdit ? (
        <>
          <p className="branding-hint">{copy.imageHelp}</p>
          <div className="branding-upload">
            <input
              ref={fileInput}
              aria-label={title}
              disabled={busy}
              type="file"
              hidden
              accept="image/png,image/jpeg"
              onChange={(event) => {
                setFile(event.target.files?.[0]);
                onPending(Boolean(event.target.files?.[0]));
                uploadKey.current = undefined;
                setError('');
              }}
            />
            <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
              {copy.choose}
            </Button>
            {file ? <span className="branding-file-name">{file.name}</span> : null}
            <Button variant="secondary" disabled={busy || !file} onClick={() => void upload()}>
              {busy ? copy.uploading : copy.upload}
            </Button>
          </div>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="branding-field-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
