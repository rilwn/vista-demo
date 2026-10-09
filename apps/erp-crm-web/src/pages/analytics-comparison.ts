import { formatOperationsNumber } from '../i18n/LocalizationProvider';

export function comparison(
  current: string,
  previous: string,
  unit: 'percent' | 'points' = 'percent',
): { label: string; tone: 'down' | 'neutral' | 'up' } {
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue))
    return { label: 'No comparison', tone: 'neutral' };
  if (unit === 'percent' && previousValue === 0 && currentValue !== 0)
    return { label: 'No earlier value to compare', tone: currentValue < 0 ? 'down' : 'neutral' };
  const delta =
    unit === 'points'
      ? currentValue - previousValue
      : previousValue === 0
        ? 0
        : ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
  if (Math.abs(delta) < 0.005) return { label: 'No change from prior period', tone: 'neutral' };
  const formatted = formatOperationsNumber(Math.abs(delta), {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  const comparisonValue = unit === 'points' ? `${formatted} points` : `${formatted}%`;
  return {
    label: `${delta > 0 ? '↑' : '↓'} ${comparisonValue} vs prior period`,
    tone: delta > 0 ? 'up' : 'down',
  };
}
