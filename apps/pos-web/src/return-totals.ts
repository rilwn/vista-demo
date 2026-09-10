import type { PosSaleLine } from '@vista/contracts';

type ReturnLine = Pick<
  PosSaleLine,
  | 'quantity'
  | 'netTotal'
  | 'vatTotal'
  | 'returnedQuantity'
  | 'returnedNetTotal'
  | 'returnedVatTotal'
>;

function units(value: string): bigint {
  if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw new Error('Invalid stored decimal');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(4, '0')}`);
}

// Match the server's stored-line allocation, including final-return rounding residue.
// Never reconstruct a refund from current prices or the pre-discount unit price.
export function returnLineGross(line: ReturnLine, selectedQuantity: number): number {
  if (!Number.isFinite(selectedQuantity) || selectedQuantity <= 0) return NaN;
  try {
    const selected = units(selectedQuantity.toFixed(4));
    const sold = units(line.quantity);
    const returned = units(line.returnedQuantity);
    if (sold <= 0n || selected + returned > sold) return NaN;
    let net: bigint;
    let vat: bigint;
    if (selected + returned === sold) {
      if (
        returned > 0n &&
        (line.returnedNetTotal === undefined || line.returnedVatTotal === undefined)
      )
        return NaN;
      net = units(line.netTotal) - units(line.returnedNetTotal ?? '0');
      vat = units(line.vatTotal) - units(line.returnedVatTotal ?? '0');
    } else {
      net = (units(line.netTotal) * selected) / sold;
      vat = (units(line.vatTotal) * selected) / sold;
    }
    return net < 0n || vat < 0n ? NaN : Number(net + vat) / 10000;
  } catch {
    return NaN;
  }
}
