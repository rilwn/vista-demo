import { Button, InlineAlert } from '@vista/ui';
import type { ManagedFile, ManagedFileParentType } from '@vista/contracts';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import {
  downloadManagedFile,
  listManagedFiles,
  listManagedFileVersions,
  uploadManagedFile,
  uploadManagedFileVersion,
} from '../api/files';
import { ApiClientError } from '../api/client';
import { Icon } from '../components/Icon';
import { messages } from '../i18n/legacyMessages';

export function PartnerDocumentsPanel({
  canEdit,
  partnerId,
  token,
}: {
  canEdit: boolean;
  partnerId: string;
  token: string;
}) {
  return (
    <ManagedFilesPanel
      canEdit={canEdit}
      copy={messages.partners.documents}
      parentId={partnerId}
      parentType="partner"
      token={token}
    />
  );
}

interface ManagedFileCopy {
  add: string;
  back: string;
  cancel: string;
  chooseFile: string;
  controlledFiles: string;
  download: string;
  downloadError: string;
  emptyDescription: string;
  emptyTitle: string;
  fileRequirements: string;
  hideVersions: string;
  integrity: string;
  loadError: string;
  loading: string;
  open: string;
  replace: string;
  replaceTitle: string;
  selection: (name: string) => string;
  subtitle: string;
  title: string;
  upload: string;
  uploadError: string;
  uploadTitle: string;
  version: (value: number) => string;
  versionCount: (count: number) => string;
  versionsError: string;
}

export function ManagedFilesPanel(props: {
  canEdit: boolean;
  copy: ManagedFileCopy;
  parentId: string;
  parentType: ManagedFileParentType;
  token: string;
}) {
  return (
    <ScopedManagedFilesPanel
      key={`${props.token}:${props.parentType}:${props.parentId}`}
      {...props}
    />
  );
}

function ScopedManagedFilesPanel({
  canEdit,
  copy,
  parentId,
  parentType,
  token,
}: {
  canEdit: boolean;
  copy: ManagedFileCopy;
  parentId: string;
  parentType: ManagedFileParentType;
  token: string;
}) {
  const [files, setFiles] = useState<ManagedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [versions, setVersions] = useState<ManagedFile[]>([]);
  const [replacing, setReplacing] = useState<string | null>(null);
  const uploadAttempt = useRef<{ fingerprint: string; key: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      const result = await listManagedFiles(token, parentType, parentId);
      setFiles(result.items);
    } catch (caught) {
      setLoadFailed(true);
      setError(errorText(caught, copy.loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [parentId, parentType, token]);

  async function upload() {
    if (!file) return;
    const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${replacing ?? 'new'}`;
    if (uploadAttempt.current?.fingerprint !== fingerprint) {
      uploadAttempt.current = { fingerprint, key: crypto.randomUUID() };
    }
    setUploading(true);
    setError(null);
    try {
      if (replacing) {
        await uploadManagedFileVersion(token, replacing, uploadAttempt.current.key, file);
      } else {
        await uploadManagedFile(token, parentType, parentId, uploadAttempt.current.key, file);
      }
      setFile(null);
      setReplacing(null);
      setShowUpload(false);
      setVersionsFor(null);
      setVersions([]);
      setInputKey((value) => value + 1);
      uploadAttempt.current = null;
      await refresh();
    } catch (caught) {
      setError(errorText(caught, copy.uploadError));
    } finally {
      setUploading(false);
    }
  }

  async function showVersions(record: ManagedFile) {
    if (versionsFor === record.id) {
      setVersionsFor(null);
      setVersions([]);
      return;
    }
    setError(null);
    try {
      setVersions(await listManagedFileVersions(token, record.id));
      setVersionsFor(record.id);
    } catch (caught) {
      setError(errorText(caught, copy.versionsError));
    }
  }

  async function download(record: ManagedFile) {
    setError(null);
    try {
      const downloaded = await downloadManagedFile(token, record);
      const url = URL.createObjectURL(downloaded.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloaded.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (caught) {
      setError(errorText(caught, copy.downloadError));
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setError(null);
    uploadAttempt.current = null;
  }

  function beginReplacement(record: ManagedFile) {
    setReplacing(record.id);
    setShowUpload(true);
    setFile(null);
    setInputKey((value) => value + 1);
    uploadAttempt.current = null;
  }

  return (
    <section className="partner-documents" aria-label={copy.title}>
      <div className="partner-documents-heading">
        <div>
          <p className="page-eyebrow">{copy.controlledFiles}</p>
          <h2>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        {canEdit ? (
          <Button
            disabled={uploading}
            onClick={() => {
              setReplacing(null);
              setShowUpload((value) => !value);
            }}
            variant="secondary"
          >
            <Icon name="plus" size={14} /> {copy.add}
          </Button>
        ) : null}
      </div>

      {showUpload ? (
        <div className="partner-document-upload">
          <div>
            <strong>{replacing ? copy.replaceTitle : copy.uploadTitle}</strong>
            <small>{copy.fileRequirements}</small>
          </div>
          <label className="partner-document-file-field">
            <span>{copy.chooseFile}</span>
            <input
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={uploading}
              key={inputKey}
              onChange={chooseFile}
              type="file"
            />
          </label>
          {file ? (
            <span className="partner-document-selection">{copy.selection(file.name)}</span>
          ) : null}
          <div className="partner-document-upload-actions">
            <Button
              disabled={uploading}
              onClick={() => {
                setShowUpload(false);
                setReplacing(null);
                setFile(null);
              }}
              variant="quiet"
            >
              {copy.cancel}
            </Button>
            <Button busy={uploading} disabled={!file} onClick={() => void upload()}>
              {copy.upload}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      {loadFailed ? (
        <Button onClick={() => void refresh()} variant="secondary">
          {messages.partners.documents.retry}
        </Button>
      ) : null}
      {loading ? <p className="partner-documents-state">{copy.loading}</p> : null}
      {!loading && !loadFailed && files.length === 0 ? (
        <div className="partner-documents-empty">
          <strong>{copy.emptyTitle}</strong>
          <p>{copy.emptyDescription}</p>
        </div>
      ) : null}
      {!loading && files.length > 0 ? (
        <div className="partner-document-list">
          {files.map((record) => (
            <article className="partner-document-card" key={record.id}>
              <div className="partner-document-type" aria-hidden="true">
                {record.mediaType === 'application/pdf' ? 'PDF' : 'IMG'}
              </div>
              <div className="partner-document-copy">
                <strong>{record.originalName}</strong>
                <span>
                  {copy.version(record.version)} · {formatBytes(record.byteSize)} ·{' '}
                  {formatDate(record.createdAt)}
                </span>
                <small>{copy.integrity}</small>
                {versionsFor === record.id ? (
                  <div className="partner-document-versions">
                    {versions.map((version) => (
                      <button key={version.id} onClick={() => void download(version)} type="button">
                        <span>{copy.version(version.version)}</span>
                        <small>
                          {formatDate(version.createdAt)} · {formatBytes(version.byteSize)}
                        </small>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="partner-document-actions">
                <Button onClick={() => void download(record)} variant="secondary">
                  {copy.download}
                </Button>
                {record.versionCount > 1 ? (
                  <Button onClick={() => void showVersions(record)} variant="quiet">
                    {versionsFor === record.id
                      ? copy.hideVersions
                      : copy.versionCount(record.versionCount)}
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    disabled={uploading}
                    onClick={() => beginReplacement(record)}
                    variant="quiet"
                  >
                    {copy.replace}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiClientError ? error.message : fallback;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}
