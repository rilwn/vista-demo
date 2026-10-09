import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageSwitcher } from './LanguageSwitcher';
import { TechnicalIdentifier } from './TechnicalIdentifier';
import { LocalizationProvider } from '../i18n/LocalizationProvider';

const identifier = 'd1a38bf1-ee29-449b-ab3e-54c95ae5d80b';
let originalClipboard: PropertyDescriptor | undefined;

describe('technical identifier control', () => {
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

  it('keeps the raw identifier out of view and copies it on request', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <LocalizationProvider>
        <TechnicalIdentifier kind="event" value={identifier} />
      </LocalizationProvider>,
    );

    expect(screen.queryByText(identifier)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy event ID' }));
    expect((await screen.findByRole('status')).textContent).toContain('Copied');
    expect(writeText).toHaveBeenCalledWith(identifier);
  });

  it('uses a Bulgarian copy label and reveals a selectable fallback if copying fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Clipboard unavailable'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <LocalizationProvider>
        <LanguageSwitcher />
        <TechnicalIdentifier kind="event" value={identifier} />
      </LocalizationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'BG' }));
    const copy = await screen.findByRole('button', {
      name: 'Копиране на идентификатора на събитието',
    });
    fireEvent.click(copy);

    const fallback = await screen.findByRole('alert');
    expect(fallback.textContent).toContain('Копирането е неуспешно');
    expect(fallback.querySelector('code')?.textContent).toBe(identifier);
    expect(writeText).toHaveBeenCalledWith(identifier);
  });
});
