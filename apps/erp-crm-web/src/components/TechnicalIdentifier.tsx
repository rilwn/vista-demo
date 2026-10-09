import { useState } from 'react';

import { useLocalization } from '../i18n/LocalizationProvider';
import { Icon } from './Icon';

export type TechnicalIdentifierKind =
  | 'event'
  | 'goodsReceipt'
  | 'partnerRecord'
  | 'purchaseOrder'
  | 'request'
  | 'signInRequest'
  | 'stockMovement'
  | 'targetRecord';

const englishLabels: Record<TechnicalIdentifierKind, string> = {
  event: 'event ID',
  goodsReceipt: 'goods receipt ID',
  partnerRecord: 'partner record ID',
  purchaseOrder: 'purchase order ID',
  request: 'request ID',
  signInRequest: 'sign-in reference',
  stockMovement: 'stock movement ID',
  targetRecord: 'record ID',
};

const bulgarianLabels: Record<TechnicalIdentifierKind, string> = {
  event: 'идентификатора на събитието',
  goodsReceipt: 'идентификатора на приемането',
  partnerRecord: 'идентификатора на партньорския запис',
  purchaseOrder: 'идентификатора на поръчката',
  request: 'идентификатора на заявката',
  signInRequest: 'референцията за вход',
  stockMovement: 'идентификатора на складовото движение',
  targetRecord: 'идентификатора на записа',
};

export function TechnicalIdentifier({
  className,
  kind,
  value,
}: {
  className?: string;
  kind: TechnicalIdentifierKind;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const { locale } = useLocalization();
  const isBulgarian = locale === 'bg';
  const label = isBulgarian ? bulgarianLabels[kind] : englishLabels[kind];
  const buttonLabel = isBulgarian ? `Копиране на ${label}` : `Copy ${label}`;

  async function copyIdentifier() {
    setCopied(false);
    setFailed(false);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setFailed(true);
    }
  }

  return (
    <span className={`technical-identifier${className ? ` ${className}` : ''}`}>
      <button
        aria-label={buttonLabel}
        onClick={() => void copyIdentifier()}
        title={buttonLabel}
        type="button"
      >
        <Icon name={copied ? 'check' : 'copy'} size={15} />
      </button>
      {copied ? (
        <span aria-live="polite" role="status">
          {isBulgarian ? 'Копирано' : 'Copied'}
        </span>
      ) : null}
      {failed ? (
        <span className="technical-identifier-fallback" role="alert">
          <span>
            {isBulgarian
              ? 'Копирането е неуспешно. Изберете и копирайте идентификатора по-долу.'
              : 'Could not copy. Select and copy the identifier below.'}
          </span>
          <code>{value}</code>
        </span>
      ) : null}
    </span>
  );
}
