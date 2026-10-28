import type { AppEnvironment } from '@vista/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CourierAdapterService, type CourierProviderError } from './courier-adapters.js';

const environment = {
  LOGISTICS_ECONT_BASE_URL: 'https://econt.test/ee/services',
  LOGISTICS_ECONT_USERNAME: 'econt-user',
  LOGISTICS_ECONT_PASSWORD: 'econt-password',
  LOGISTICS_ECONT_SENDER_NAME: 'Vista Service Ltd.',
  LOGISTICS_ECONT_SENDER_PHONE: '+359888123456',
  LOGISTICS_ECONT_SENDER_OFFICE_CODE: 'VR001',
  LOGISTICS_SPEEDY_BASE_URL: 'https://speedy.test/v1',
  LOGISTICS_SPEEDY_USERNAME: 'speedy-user',
  LOGISTICS_SPEEDY_PASSWORD: 'speedy-password',
  LOGISTICS_SPEEDY_SERVICE_ID: '505',
} as AppEnvironment;

const shipment = {
  addressLine1: 'Central Street 1',
  city: 'Vratsa',
  countryCode: 'BG',
  customerName: 'Alfa Market Ltd.',
  deliveryNumber: 'DLV-2026-000001',
  instructions: 'Call on arrival',
  parcelCount: 2,
  parcelWeightKg: '3.250',
  postalCode: '3000',
  recipientName: 'Ivan Petrov',
  recipientPhone: '+359888987654',
  shipmentNumber: 'SH-2026-000001',
};

afterEach(() => vi.unstubAllGlobals());

describe('courier adapters', () => {
  it('creates and tracks Econt labels using the delivery reference and maps tracking scans', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ label: { shipmentNumber: 'EC-123', shortDeliveryStatusEn: 'Created' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          shipmentStatuses: [
            {
              status: {
                shortDeliveryStatusEn: 'In transit',
                trackingEvents: [
                  {
                    cityNameEn: 'Vratsa',
                    descriptionEn: 'Accepted at office',
                    time: '2026-10-27T09:00:00Z',
                    type: 1,
                  },
                ],
              },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new CourierAdapterService(environment);

    const created = await adapter.create('econt', shipment);
    const tracking = await adapter.track(
      'econt',
      created.providerReference,
      shipment.deliveryNumber,
    );

    expect(created).toEqual({ providerReference: 'EC-123', providerStatus: 'Created' });
    expect(tracking).toEqual({
      events: [
        {
          description: 'Accepted at office',
          occurredAt: '2026-10-27T09:00:00.000Z',
          place: 'Vratsa',
          status: '1',
        },
      ],
      providerStatus: 'In transit',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://econt.test/ee/services/Shipments/LabelService.createLabel.json',
    );
    const createOptions = fetchMock.mock.calls[0]?.[1];
    expect(parseJsonBody(fetchMock.mock.calls[0])).toMatchObject({
      label: { orderNumber: 'DLV-2026-000001', weight: 3.25 },
    });
    expect((createOptions?.headers as Record<string, string> | undefined)?.authorization).toMatch(
      /^Basic /u,
    );
  });

  it('searches Speedy by Vista reference before creating and tracks by that same reference', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ barcodes: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'SP-456' }))
      .mockResolvedValueOnce(jsonResponse({ barcodes: ['SP-456-1', 'SP-456-2'] }))
      .mockResolvedValueOnce(jsonResponse({ barcodes: ['SP-456-1', 'SP-456-2'] }))
      .mockResolvedValueOnce(
        jsonResponse({
          parcels: [
            {
              operations: [
                {
                  dateTime: '2026-10-27T10:15:00Z',
                  description: 'Shipment accepted',
                  operationCode: 1,
                  place: 'Vratsa',
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new CourierAdapterService(environment);

    const created = await adapter.create('speedy', shipment);
    const tracking = await adapter.track(
      'speedy',
      created.providerReference,
      shipment.deliveryNumber,
    );

    expect(created).toEqual({ providerReference: 'SP-456-1', providerStatus: 'Shipment created' });
    expect(tracking.events[0]).toMatchObject({
      description: 'Shipment accepted',
      occurredAt: '2026-10-27T10:15:00.000Z',
      place: 'Vratsa',
      status: '1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://speedy.test/v1/shipment/search',
      'https://speedy.test/v1/shipment',
      'https://speedy.test/v1/shipment/search',
      'https://speedy.test/v1/shipment/search',
      'https://speedy.test/v1/track',
    ]);
    expect(parseJsonBody(fetchMock.mock.calls[0])).toMatchObject({
      ref: 'DLV-2026-000001',
      searchInRef: 1,
    });
    expect(parseJsonBody(fetchMock.mock.calls[1])).toMatchObject({
      recipient: { clientName: 'Alfa Market Ltd.', contactName: 'Ivan Petrov' },
      ref1: 'DLV-2026-000001',
    });
    expect(parseJsonBody(fetchMock.mock.calls[4])).toMatchObject({
      parcels: [{ fullBarcode: 'SP-456-1' }, { fullBarcode: 'SP-456-2' }],
    });
  });

  it('will not confirm a Speedy parcel that is not linked to this Vista delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ barcodes: ['SP-OTHER'] }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new CourierAdapterService(environment);

    await expect(adapter.track('speedy', 'SP-FAKE', shipment.deliveryNumber)).rejects.toMatchObject(
      {
        outcome: 'rejected',
        message: 'That Speedy tracking number does not match this Vista delivery.',
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not expose the Econt demo service as a production connection', () => {
    const adapter = new CourierAdapterService({
      ...environment,
      LOGISTICS_ECONT_BASE_URL: 'https://demo.econt.com/ee/services',
      VISTA_DEPLOYMENT_STAGE: 'production',
    });

    expect(adapter.isConfigured('econt')).toBe(false);
  });

  it('does not convert an ambiguous provider timeout into a safe-to-retry rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket timeout')));
    const adapter = new CourierAdapterService(environment);

    await expect(adapter.create('econt', shipment)).rejects.toMatchObject({
      outcome: 'uncertain',
    } satisfies Partial<CourierProviderError>);
  });

  it('rejects partial courier configuration instead of exposing the provider as ready', () => {
    const adapter = new CourierAdapterService({
      ...environment,
      LOGISTICS_ECONT_PASSWORD: '',
    });

    expect(adapter.isConfigured('econt')).toBe(false);
    expect(adapter.isConfigured('speedy')).toBe(true);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function parseJsonBody(call: Parameters<typeof fetch> | undefined): unknown {
  const body = call?.[1]?.body;
  if (typeof body !== 'string') throw new Error('Expected a JSON request body.');
  return JSON.parse(body) as unknown;
}
