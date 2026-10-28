import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerPaymentStatusPage } from '@vista/contracts';
import { FinancePaymentStatusRegister } from './FinancePaymentStatusRegister';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const paymentStatusPage: CustomerPaymentStatusPage = {
  items: [
    {
      creditTotal: '0.0000',
      currencyCode: 'EUR',
      customerName: 'Alfa Market Demo Ltd.',
      customerPartnerId: '71f4f68b-f880-43ce-8d43-b86f17a5c5b1',
      dueDate: '2026-10-31',
      id: 'ec15748e-9346-4b92-9523-67c7f2b994fd',
      number: 'DEV-SO-0007',
      outstandingTotal: '20.0000',
      paidTotal: '4.0000',
      paymentStatus: 'partially_paid',
      referenceNumber: '0000000007',
      sourceType: 'pos_sale',
      total: '24.0000',
    },
  ],
  page: 1,
  pageSize: 25,
  totalItems: 1,
  totalPages: 1,
};

describe('Finance payment status register', () => {
  it('searches and filters on the server, then opens the customer account', async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        urls.push(new URL(url, window.location.origin));
        return Promise.resolve(
          new Response(JSON.stringify(paymentStatusPage), {
            headers: { 'content-type': 'application/json' },
          }),
        );
      }),
    );
    const onOpenAccount = vi.fn();
    render(<FinancePaymentStatusRegister onOpenAccount={onOpenAccount} token="test-token" />);

    expect(await screen.findByText('DEV-SO-0007')).toBeTruthy();
    expect(screen.getByText('POS sale · Fiscal receipt: 0000000007')).toBeTruthy();
    expect(screen.getByText('Total amount')).toBeTruthy();
    fireEvent.change(
      screen.getByRole('searchbox', { name: 'Customer, invoice, sale or receipt' }),
      {
        target: { value: 'Alfa' },
      },
    );
    await waitFor(() =>
      expect(urls.some((url) => url.searchParams.get('search') === 'Alfa')).toBe(true),
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
      target: { value: 'partially_paid' },
    });
    await waitFor(() =>
      expect(urls.some((url) => url.searchParams.get('status') === 'partially_paid')).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(onOpenAccount).toHaveBeenCalledWith('71f4f68b-f880-43ce-8d43-b86f17a5c5b1');
  });
});
