import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ManagedFile } from '@vista/contracts';
import { PartnerDocumentsPanel } from './PartnerDocumentsPanel';
import { listManagedFiles, uploadManagedFile } from '../api/files';
import { messages } from '../messages';

vi.mock('../api/files');
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const empty = { items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 };
const record: ManagedFile = {
  id: 'file',
  parentId: 'first',
  parentType: 'partner',
  byteSize: 20,
  checksumSha256: 'checksum',
  createdAt: '2026-09-10T10:00:00Z',
  isCurrent: true,
  issuerAccountId: 'issuer',
  mediaType: 'application/pdf',
  originalName: 'original.pdf',
  status: 'available',
  version: 1,
  versionCount: 1,
  versionGroupId: 'group',
};

it('offers retry instead of claiming a failed list is empty', async () => {
  vi.mocked(listManagedFiles).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(empty);
  render(<PartnerDocumentsPanel canEdit partnerId="first" token="session" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  expect(screen.queryByText(messages.partners.documents.emptyTitle)).toBeNull();
  await screen.findByText(messages.partners.documents.emptyTitle);
  expect(listManagedFiles).toHaveBeenCalledTimes(2);
});

it('retains the upload key and selected file after an uncertain response', async () => {
  vi.mocked(listManagedFiles).mockResolvedValue(empty);
  vi.mocked(uploadManagedFile)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(record);
  render(<PartnerDocumentsPanel canEdit partnerId="first" token="session" />);
  await screen.findByText(messages.partners.documents.emptyTitle);
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
  const file = new File(['%PDF-1.4'], 'original.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Choose file'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await screen.findByText(messages.partners.documents.uploadError);
  fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(uploadManagedFile).toHaveBeenCalledTimes(2));
  const calls = vi.mocked(uploadManagedFile).mock.calls;
  expect(calls[0]).toEqual(calls[1]);
  expect(calls[0]?.[4]).toBe(file);
});

it('clears the previous parent and hides editing for a read-only account', async () => {
  vi.mocked(listManagedFiles)
    .mockResolvedValueOnce({ ...empty, items: [record], total: 1 })
    .mockResolvedValue(empty);
  const view = render(<PartnerDocumentsPanel canEdit partnerId="first" token="session" />);
  await screen.findByText('original.pdf');
  view.rerender(<PartnerDocumentsPanel canEdit={false} partnerId="second" token="viewer" />);
  expect(screen.queryByText('original.pdf')).toBeNull();
  await screen.findByText(messages.partners.documents.emptyTitle);
  expect(screen.queryByRole('button', { name: 'Add document' })).toBeNull();
  expect(listManagedFiles).toHaveBeenLastCalledWith('viewer', 'partner', 'second');
});
