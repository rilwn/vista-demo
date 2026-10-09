import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckoutReference } from './CheckoutReference';
import { LanguageSwitcher } from './i18n/LanguageSwitcher';
import { LocalizationProvider } from './i18n/LocalizationProvider';

const transactionId = 'f49ac1f2-cb5a-4cd8-88bd-b5e9d25d7046';
let originalClipboard: PropertyDescriptor | undefined;

describe('POS checkout reference', () => {
  beforeEach(() => {
    window.localStorage.clear();
    originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies the full checkout ID without displaying it by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <LocalizationProvider>
        <CheckoutReference value={transactionId} />
      </LocalizationProvider>,
    );

    expect(screen.queryByText(transactionId)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy checkout ID' }));
    expect((await screen.findByRole('status')).textContent).toBe('Copied');
    expect(writeText).toHaveBeenCalledWith(transactionId);
  });

  it('shows Bulgarian control text and a selectable ID if clipboard access fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Unavailable'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <LocalizationProvider>
        <LanguageSwitcher />
        <CheckoutReference value={transactionId} />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'BG' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Копиране на идентификатора на транзакцията' }),
    );
    const fallback = await screen.findByRole('alert');
    expect(fallback.textContent).toContain('Копирането е неуспешно');
    expect(fallback.querySelector('code')?.textContent).toBe(transactionId);
  });
});
