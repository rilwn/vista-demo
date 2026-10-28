import type { PosVatTreatment } from '@vista/contracts';
import type { DatecsFiscalSaleConfiguration } from './datecs-fiscal-sale';

export type DatecsSaleSettings = Pick<
  DatecsFiscalSaleConfiguration,
  'operatorNumber' | 'registerLocationNumber' | 'taxGroups'
> & {
  deviceSerial: string;
  operatorIdentifier: string;
};

export const defaultDatecsTaxGroups: DatecsFiscalSaleConfiguration['taxGroups'] = {
  standard_20: { group: 'B', ratePercent: '20.00' },
  reduced_9: { group: 'C', ratePercent: '9.00' },
  zero: { group: 'D', ratePercent: '0.00' },
  exempt: { group: 'E', ratePercent: '0.00' },
  ica: { group: 'B', ratePercent: '20.00' },
};

export function emptyDatecsSaleSettings(operatorIdentifier = ''): DatecsSaleSettings {
  const normalizedOperatorIdentifier = operatorIdentifier.trim().toUpperCase();
  return {
    deviceSerial: '',
    operatorIdentifier: /^[A-Z0-9]{4}$/u.test(normalizedOperatorIdentifier)
      ? normalizedOperatorIdentifier
      : '',
    operatorNumber: 1,
    registerLocationNumber: 1,
    taxGroups: structuredClone(defaultDatecsTaxGroups),
  };
}

export function readDatecsSaleSettings(
  accountId: string,
  registerId: string,
  fallbackOperatorIdentifier = '',
): DatecsSaleSettings {
  const fallback = emptyDatecsSaleSettings(fallbackOperatorIdentifier);
  try {
    const stored = localStorage.getItem(settingsKey(accountId, registerId));
    if (!stored) return fallback;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    const record = parsed as Record<string, unknown>;
    return {
      deviceSerial: typeof record.deviceSerial === 'string' ? record.deviceSerial : '',
      operatorIdentifier:
        typeof record.operatorIdentifier === 'string' ? record.operatorIdentifier : '',
      operatorNumber: readInteger(record.operatorNumber, 1, 16, fallback.operatorNumber),
      registerLocationNumber: readInteger(
        record.registerLocationNumber,
        1,
        99999,
        fallback.registerLocationNumber,
      ),
      taxGroups: readTaxGroups(record.taxGroups) ?? fallback.taxGroups,
    };
  } catch {
    return fallback;
  }
}

export function saveDatecsSaleSettings(
  accountId: string,
  registerId: string,
  settings: DatecsSaleSettings,
): void {
  try {
    localStorage.setItem(settingsKey(accountId, registerId), JSON.stringify(settings));
  } catch {
    // A blocked or full browser store must not interrupt sales setup.
  }
}

export function isValidDatecsSaleSettings(settings: DatecsSaleSettings): boolean {
  return (
    /^[A-Z0-9]{8}$/u.test(settings.deviceSerial) &&
    /^[A-Z0-9]{4}$/u.test(settings.operatorIdentifier) &&
    Number.isInteger(settings.operatorNumber) &&
    settings.operatorNumber >= 1 &&
    settings.operatorNumber <= 16 &&
    Number.isInteger(settings.registerLocationNumber) &&
    settings.registerLocationNumber >= 1 &&
    settings.registerLocationNumber <= 99999 &&
    Object.keys(defaultDatecsTaxGroups).every((treatment) => {
      const key = treatment as PosVatTreatment;
      return /^[A-H]$/u.test(settings.taxGroups[key]?.group ?? '');
    })
  );
}

function settingsKey(accountId: string, registerId: string): string {
  return `vista.pos.datecs.settings.v1:${accountId}:${registerId}`;
}

function readInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function readTaxGroups(value: unknown): DatecsFiscalSaleConfiguration['taxGroups'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const groups = {} as DatecsFiscalSaleConfiguration['taxGroups'];
  for (const treatment of Object.keys(defaultDatecsTaxGroups) as PosVatTreatment[]) {
    const entry = record[treatment];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const config = entry as Record<string, unknown>;
    const group = config.group;
    const ratePercent = config.ratePercent;
    if (
      typeof group !== 'string' ||
      !/^[A-H]$/u.test(group) ||
      typeof ratePercent !== 'string' ||
      ratePercent !== defaultDatecsTaxGroups[treatment].ratePercent
    )
      return undefined;
    groups[treatment] = {
      group: group as DatecsFiscalSaleConfiguration['taxGroups'][PosVatTreatment]['group'],
      ratePercent,
    };
  }
  return groups;
}
