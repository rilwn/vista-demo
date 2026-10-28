import type { PosCatalogItem, PosFiscalReceiptLine } from '@vista/contracts';

export interface OfflineBasketLine {
  batchId?: string;
  item: PosCatalogItem;
  quantity: number;
  serialNumber?: string;
}

/** Builds the exact gross-price lines printed for a supported offline cash sale. */
export function offlineFiscalLinesFor(
  lines: OfflineBasketLine[],
): PosFiscalReceiptLine[] | undefined {
  if (!lines.length) return undefined;
  const result: PosFiscalReceiptLine[] = [];
  for (const line of lines) {
    const netUnitPrice = Number(line.item.unitPrice);
    const vatTreatment = line.item.vatTreatment;
    if (
      !Number.isFinite(netUnitPrice) ||
      netUnitPrice <= 0 ||
      !vatTreatment ||
      !Number.isInteger(line.quantity) ||
      line.quantity <= 0
    )
      return undefined;
    if (line.item.trackingMode === 'serial') {
      if (
        line.quantity !== 1 ||
        !line.serialNumber ||
        !line.item.serialNumbers.some(
          (serial) => serial.toUpperCase() === line.serialNumber?.toUpperCase(),
        ) ||
        line.batchId
      )
        return undefined;
    } else if (
      line.serialNumber ||
      (line.item.trackingMode === 'batch' &&
        (!line.batchId ||
          !line.item.batches.some(
            (batch) => batch.batchId === line.batchId && Number(batch.quantity) >= line.quantity,
          ))) ||
      (line.item.trackingMode !== 'batch' && line.batchId)
    )
      return undefined;
    const unitPriceEur = (netUnitPrice * (1 + vatRate(vatTreatment))).toFixed(2);
    const grossTotalEur = (Number(unitPriceEur) * line.quantity).toFixed(2);
    result.push({
      description: line.item.name,
      grossTotalEur,
      quantity: String(line.quantity),
      unitCode: line.item.unitCode,
      unitPriceEur,
      vatTreatment,
    });
  }
  return result;
}

export function exceedsCachedOfflineStock(lines: OfflineBasketLine[]): boolean {
  const quantities = new Map<string, { available: number; requested: number }>();
  const batchQuantities = new Map<string, { available: number; requested: number }>();
  const selectedSerials = new Set<string>();
  for (const line of lines) {
    if (
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      (line.item.trackingMode === 'serial' &&
        (line.quantity !== 1 ||
          !line.serialNumber ||
          !line.item.serialNumbers.some(
            (serial) => serial.toUpperCase() === line.serialNumber?.toUpperCase(),
          ) ||
          line.batchId)) ||
      (line.item.trackingMode !== 'serial' && line.serialNumber) ||
      (line.item.trackingMode === 'batch' &&
        (!line.batchId || !line.item.batches.some((batch) => batch.batchId === line.batchId))) ||
      (line.item.trackingMode !== 'batch' && line.batchId)
    )
      return true;
    if (line.item.trackingMode === 'serial' && line.serialNumber) {
      const serialKey = `${line.item.id}\u0000${line.serialNumber.toUpperCase()}`;
      if (selectedSerials.has(serialKey)) return true;
      selectedSerials.add(serialKey);
    }
    const cachedAvailable = Number(line.item.availableQuantity);
    const existing = quantities.get(line.item.id);
    const totals = existing
      ? { available: Math.min(existing.available, cachedAvailable), requested: existing.requested }
      : { available: cachedAvailable, requested: 0 };
    totals.requested += line.quantity;
    quantities.set(line.item.id, totals);

    if (line.item.trackingMode === 'batch' && line.batchId) {
      const batch = line.item.batches.find((candidate) => candidate.batchId === line.batchId);
      const cachedBatchAvailable = Number(batch?.quantity);
      const batchKey = `${line.item.id}\u0000${line.batchId}`;
      const existingBatch = batchQuantities.get(batchKey);
      const batchTotals = existingBatch
        ? {
            available: Math.min(existingBatch.available, cachedBatchAvailable),
            requested: existingBatch.requested,
          }
        : { available: cachedBatchAvailable, requested: 0 };
      batchTotals.requested += line.quantity;
      batchQuantities.set(batchKey, batchTotals);
    }
  }
  return [...quantities.values(), ...batchQuantities.values()].some(
    ({ available, requested }) =>
      !Number.isFinite(available) || available < 0 || requested > available,
  );
}

function vatRate(treatment: PosCatalogItem['vatTreatment']): number {
  if (treatment === 'reduced_9') return 0.09;
  if (treatment === 'standard_20' || treatment === 'ica') return 0.2;
  return 0;
}
