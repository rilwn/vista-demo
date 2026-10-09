import { useState } from 'react';

import { useLocalization } from './i18n/LocalizationProvider';

export function CheckoutReference({ value }: { value: string }) {
  const { locale } = useLocalization();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const label = locale === 'bg' ? 'идентификатора на транзакцията' : 'checkout ID';
  const buttonLabel = locale === 'bg' ? `Копиране на ${label}` : `Copy ${label}`;

  async function copy() {
    setState('idle');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="pos-checkout-reference">
      <button
        aria-label={buttonLabel}
        onClick={() => void copy()}
        title={buttonLabel}
        type="button"
      >
        {state === 'copied' ? (
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m4 10 4 4 8-8" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <rect height="11" rx="1.5" width="10" x="7" y="7" />
            <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          </svg>
        )}
      </button>
      {state === 'copied' ? (
        <span aria-live="polite" role="status">
          {locale === 'bg' ? 'Копирано' : 'Copied'}
        </span>
      ) : null}
      {state === 'failed' ? (
        <span className="pos-checkout-reference-fallback" role="alert">
          <span>
            {locale === 'bg'
              ? 'Копирането е неуспешно. Изберете и копирайте стойността по-долу.'
              : 'Could not copy. Select and copy the value below.'}
          </span>
          <code>{value}</code>
        </span>
      ) : null}
    </span>
  );
}
