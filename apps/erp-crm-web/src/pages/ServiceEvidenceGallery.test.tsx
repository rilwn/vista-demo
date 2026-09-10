import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ServiceEvidenceGallery } from './ServiceEvidenceGallery';
import { fetchServicePhoto } from '../api/service';
vi.mock('../api/service');
beforeEach(() => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = vi.fn(() => 'blob:photo');
      static override revokeObjectURL = vi.fn();
    },
  );
});
const workOrder = {
  id: 'work',
  photos: ['one', 'two'].map((id) => ({
    id,
    fileName: `${id}.png`,
    mediaType: 'image/png' as const,
    sizeBytes: 67,
    capturedAt: '2026-09-10T12:00:00Z',
  })),
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it('keeps a successful photo visible when another fails and retries only that image', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.mocked(fetchServicePhoto)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue(new Blob(['photo']));
  render(<ServiceEvidenceGallery token="test" workOrder={workOrder} />);
  await screen.findByRole('img', { name: 'Service photo: two.png' });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('img', { name: 'Service photo: one.png' });
  expect(fetchServicePhoto).toHaveBeenCalledTimes(3);
  expect(screen.getAllByRole('link', { name: 'Download' })).toHaveLength(2);
});
it('does not create an object URL after its gallery has been closed', async () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  let resolve!: (blob: Blob) => void;
  vi.mocked(fetchServicePhoto).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <ServiceEvidenceGallery
      token="test"
      workOrder={{ ...workOrder, photos: workOrder.photos.slice(0, 1) }}
    />,
  );
  view.unmount();
  await act(async () => {
    resolve(new Blob(['photo']));
    await Promise.resolve();
  });
  expect(create).not.toHaveBeenCalled();
});
