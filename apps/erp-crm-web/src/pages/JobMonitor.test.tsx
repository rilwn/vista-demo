import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { JobMonitor } from './JobMonitor';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const data = {
  waiting: 4,
  active: 2,
  delayed: 3,
  failed: 0,
  completed: 9,
  paused: false,
  timestamp: '2026-09-09T12:00:00Z',
};
it('shows real counts and recovers after a failed refresh without showing stale values', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(data)))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...data, paused: true }))),
  );
  render(<JobMonitor token="test" />);
  expect(await screen.findByText('Queue is not paused')).toBeTruthy();
  expect(screen.getByText('9')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh processing status' }));
  expect(await screen.findByText(/Processing status could not be checked/u)).toBeTruthy();
  expect(screen.queryByText('9')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh processing status' }));
  expect(await screen.findByText('Processing is paused')).toBeTruthy();
});
it('rejects malformed results instead of presenting false health', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
  render(<JobMonitor token="test" />);
  expect(await screen.findByText(/Processing status could not be checked/u)).toBeTruthy();
});
