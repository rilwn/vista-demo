export function isMaterialCostVariance(baseline: string | undefined, receipt: string): boolean {
  if (!baseline || !/^\d+(\.\d{1,4})?$/u.test(baseline) || !/^\d+(\.\d{1,4})?$/u.test(receipt))
    return false;
  const baselineUnits = decimalUnits(baseline);
  if (baselineUnits <= 0n) return false;
  const difference = decimalUnits(receipt) - baselineUnits;
  return (difference < 0n ? -difference : difference) * 100n >= baselineUnits * 10n;
}

function decimalUnits(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0')}`);
}
