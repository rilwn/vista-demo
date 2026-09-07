import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreatePosSaleRequest, PosSale } from '@vista/contracts';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutRecovery } from './CheckoutRecovery';
import { completePosSale, findPosCheckout } from './api/pos';
import { readCheckout, saveCheckout, clearCheckout } from './checkout-store';
import { TestCheckoutChannel } from './test-checkout-channel';

vi.mock('./api/pos', () => ({ completePosSale: vi.fn(), findPosCheckout: vi.fn() }));
const request: CreatePosSaleRequest = {
  clientTransactionId: '86a47c28-7521-4a81-aafd-c04d92363230',
  shiftId: '93045dfc-5bbe-43e9-bff0-ec563915ece5',
  lines: [{ productId: 'f5f78775-ac83-4cdc-bf6e-760377ff789a', quantity: '1.0000' }],
  payments: [{ amount: '60.0000', method: 'cash', tenderedAmount: '100.0000' }],
};
const sale = { id: 'recovered-sale' } as PosSale;
beforeEach(async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', TestCheckoutChannel);
  vi.resetAllMocks();
  await saveCheckout({ accountId: 'cashier', request, savedAt: new Date().toISOString() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('recovers a completed sale after reopening without sending another payment', async () => {
  vi.mocked(findPosCheckout).mockResolvedValue(sale);
  const recovered = vi.fn();
  render(
    <CheckoutRecovery
      accountId="cashier"
      token="token"
      refresh={0}
      onBlocked={vi.fn()}
      onRecovered={recovered}
    />,
  );
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(sale));
  expect(completePosSale).not.toHaveBeenCalled();
  expect(await readCheckout('cashier')).toBeUndefined();
});

it('removes a stale connection warning when another tab resolves the checkout', async () => {
  vi.mocked(findPosCheckout).mockRejectedValue(new Error('Offline'));
  const count = vi.fn();
  render(
    <CheckoutRecovery
      accountId="cashier"
      token="token"
      refresh={0}
      onPending={count}
      onBlocked={vi.fn()}
      onRecovered={vi.fn()}
    />,
  );
  await screen.findByText('Waiting for a connection. This checkout is saved on this device.');
  await clearCheckout('cashier', request.clientTransactionId, {
    kind: 'confirmed',
    saleNumber: 'SALE-01',
  });
  await waitFor(() => expect(count).toHaveBeenLastCalledWith(0));
  expect(
    screen.queryByText('Waiting for a connection. This checkout is saved on this device.'),
  ).toBeNull();
  expect(completePosSale).not.toHaveBeenCalled();
});

it('retains an unavailable checkout, checks again online and retries only on cashier request', async () => {
  vi.mocked(findPosCheckout).mockRejectedValue(new Error('Offline'));
  vi.mocked(completePosSale).mockResolvedValue(sale);
  const recovered = vi.fn();
  render(
    <CheckoutRecovery
      accountId="cashier"
      token="token"
      refresh={0}
      onBlocked={vi.fn()}
      onRecovered={recovered}
    />,
  );
  await screen.findByText('Waiting for a connection. This checkout is saved on this device.');
  expect(await readCheckout('cashier')).toBeDefined();
  expect(completePosSale).not.toHaveBeenCalled();
  vi.mocked(findPosCheckout).mockResolvedValue(undefined);
  fireEvent(window, new Event('online'));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Retry saved checkout' }).hasAttribute('disabled'),
    ).toBe(false),
  );
  expect(completePosSale).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved checkout' }));
  await waitFor(() => expect(recovered).toHaveBeenCalledWith(sale));
  expect(completePosSale).toHaveBeenCalledExactlyOnceWith(
    'token',
    request,
    request.clientTransactionId,
  );
});
