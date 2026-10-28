import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';

import { APP_ENVIRONMENT } from '../config/config.module.js';

export interface CourierShipmentInput {
  addressLine1: string;
  city: string;
  countryCode: string;
  customerName: string;
  deliveryNumber: string;
  instructions?: string;
  parcelCount: number;
  parcelWeightKg: string;
  postalCode?: string;
  recipientName: string;
  recipientPhone: string;
  shipmentNumber: string;
}

export interface CourierBookingResult {
  providerReference: string;
  providerStatus: string;
}

export interface CourierTrackingResult {
  events: Array<{ description: string; occurredAt: string; place?: string; status: string }>;
  providerStatus: string;
}

export class CourierProviderError extends Error {
  constructor(
    message: string,
    readonly outcome: 'rejected' | 'uncertain' | 'unavailable',
  ) {
    super(message);
    this.name = 'CourierProviderError';
  }
}

@Injectable()
export class CourierAdapterService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

  isConfigured(provider: 'econt' | 'speedy'): boolean {
    if (provider === 'econt') {
      const credentialsReady = Boolean(
        this.environment.LOGISTICS_ECONT_USERNAME &&
        this.environment.LOGISTICS_ECONT_PASSWORD &&
        this.environment.LOGISTICS_ECONT_SENDER_NAME &&
        this.environment.LOGISTICS_ECONT_SENDER_PHONE &&
        this.environment.LOGISTICS_ECONT_SENDER_OFFICE_CODE,
      );
      const isProductionDemoEndpoint =
        this.environment.VISTA_DEPLOYMENT_STAGE === 'production' &&
        new URL(this.environment.LOGISTICS_ECONT_BASE_URL).hostname === 'demo.econt.com';
      return credentialsReady && !isProductionDemoEndpoint;
    }
    return Boolean(
      this.environment.LOGISTICS_SPEEDY_USERNAME &&
      this.environment.LOGISTICS_SPEEDY_PASSWORD &&
      this.environment.LOGISTICS_SPEEDY_SERVICE_ID,
    );
  }

  async create(
    provider: 'econt' | 'speedy',
    shipment: CourierShipmentInput,
  ): Promise<CourierBookingResult> {
    if (!this.isConfigured(provider))
      throw new CourierProviderError(`${provider} is not configured.`, 'rejected');
    return provider === 'econt' ? this.createEcont(shipment) : this.createSpeedy(shipment);
  }

  async track(
    provider: 'econt' | 'speedy',
    providerReference: string,
    deliveryNumber: string,
  ): Promise<CourierTrackingResult> {
    if (!this.isConfigured(provider))
      throw new CourierProviderError(`${provider} is not configured.`, 'unavailable');
    return provider === 'econt'
      ? this.trackEcont(providerReference)
      : this.trackSpeedy(providerReference, deliveryNumber);
  }

  private async createEcont(shipment: CourierShipmentInput): Promise<CourierBookingResult> {
    const result = await this.econtRequest(
      'Shipments/LabelService.createLabel.json',
      {
        mode: 'create',
        label: {
          orderNumber: shipment.deliveryNumber,
          receiverAddress: {
            city: {
              name: shipment.city,
              ...(shipment.postalCode ? { postCode: shipment.postalCode } : {}),
            },
            fullAddress: shipment.addressLine1,
          },
          receiverClient: { name: shipment.recipientName, phones: [shipment.recipientPhone] },
          packCount: shipment.parcelCount,
          senderClient: {
            name: this.environment.LOGISTICS_ECONT_SENDER_NAME,
            phones: [this.environment.LOGISTICS_ECONT_SENDER_PHONE],
          },
          senderOfficeCode: this.environment.LOGISTICS_ECONT_SENDER_OFFICE_CODE,
          shipmentDescription: shipment.shipmentNumber,
          shipmentType: 'pack',
          weight: Number(shipment.parcelWeightKg),
          ...(shipment.instructions
            ? { instructions: [{ description: shipment.instructions }] }
            : {}),
        },
      },
      'create',
    );
    const label = objectValue(result['label']);
    const reference = stringValue(label?.['shipmentNumber']);
    if (!reference)
      throw new CourierProviderError(
        'Econt accepted the request but returned no shipment number. Check the carrier account before retrying.',
        'uncertain',
      );
    return {
      providerReference: reference,
      providerStatus: stringValue(label?.['shortDeliveryStatusEn']) ?? 'Shipment created',
    };
  }

  private async trackEcont(reference: string): Promise<CourierTrackingResult> {
    const result = await this.econtRequest(
      'Shipments/ShipmentService.getShipmentStatuses.json',
      { shipmentNumbers: [reference] },
      'track',
    );
    const entries = Array.isArray(result['shipmentStatuses']) ? result['shipmentStatuses'] : [];
    const statusResult = objectValue(entries[0]);
    const status = objectValue(statusResult?.['status']);
    if (!status)
      throw new CourierProviderError('Econt returned no shipment status.', 'unavailable');
    const events = Array.isArray(status['trackingEvents']) ? status['trackingEvents'] : [];
    const mapped = events.flatMap((entry) => {
      const item = objectValue(entry);
      const description =
        stringValue(item?.['descriptionEn']) ?? stringValue(item?.['description']);
      const occurredAt = dateString(item?.['time']);
      const place = stringValue(item?.['cityNameEn']) ?? stringValue(item?.['cityName']);
      if (!description || !occurredAt) return [];
      return [
        {
          description,
          occurredAt,
          ...(place ? { place } : {}),
          status: stringValue(item?.['type']) ?? description,
        },
      ];
    });
    const providerStatus =
      stringValue(status['shortDeliveryStatusEn']) ??
      stringValue(status['shortDeliveryStatus']) ??
      'Tracking updated';
    if (mapped.length === 0)
      mapped.push({
        description: providerStatus,
        occurredAt: dateString(status['createdTime']) ?? new Date().toISOString(),
        status: providerStatus,
      });
    return { events: mapped, providerStatus };
  }

  private async createSpeedy(shipment: CourierShipmentInput): Promise<CourierBookingResult> {
    // Speedy supports searching shipment references. Resolve a prior accepted request
    // before creating again, so a lost response cannot produce a duplicate label.
    const existingReferences = await this.findSpeedyReferences(shipment.deliveryNumber);
    const existingReference = existingReferences[0];
    if (existingReference) {
      return {
        providerReference: existingReference,
        providerStatus: 'Existing shipment found',
      };
    }

    const clientName = shipment.customerName.trim();
    const contactName = shipment.recipientName.trim();
    if (clientName.length < 3 || clientName.length > 60 || contactName.length > 60)
      throw new CourierProviderError(
        'The customer or contact name is outside Speedy’s supported length. Update the business record or recipient details before booking.',
        'rejected',
      );
    if (shipment.countryCode !== 'BG')
      throw new CourierProviderError(
        'Speedy booking is currently configured for Bulgarian delivery addresses only.',
        'rejected',
      );

    const created = await this.speedyRequest(
      'shipment',
      {
        language: 'EN',
        recipient: {
          address: {
            addressNote: shipment.addressLine1,
            ...(shipment.postalCode ? { postCode: shipment.postalCode } : {}),
            siteName: shipment.city,
          },
          clientName,
          contactName,
          privatePerson: false,
          phone1: { number: normalizeSpeedyPhone(shipment.recipientPhone) },
        },
        service: { serviceId: Number(this.environment.LOGISTICS_SPEEDY_SERVICE_ID) },
        content: {
          contents: shipment.shipmentNumber,
          package: 'Parcel',
          parcelsCount: shipment.parcelCount,
          totalWeight: Number(shipment.parcelWeightKg),
        },
        payment: { courierServicePayer: 'SENDER' },
        ref1: shipment.deliveryNumber,
        shipmentNote: shipment.instructions?.slice(0, 200),
        userName: this.environment.LOGISTICS_SPEEDY_USERNAME,
        password: this.environment.LOGISTICS_SPEEDY_PASSWORD,
      },
      'create',
    );
    if (!stringValue(created['id']))
      throw new CourierProviderError(
        'Speedy accepted the request but returned no shipment ID. Tracking by the Vista reference is required before retrying.',
        'uncertain',
      );
    const createdReferences = await this.findSpeedyReferences(shipment.deliveryNumber);
    const providerReference = createdReferences[0];
    if (!providerReference)
      throw new CourierProviderError(
        'Speedy accepted the shipment but its tracking number is not available yet. Check the Speedy account before retrying.',
        'uncertain',
      );
    return { providerReference, providerStatus: 'Shipment created' };
  }

  private async trackSpeedy(
    reference: string,
    deliveryNumber: string,
  ): Promise<CourierTrackingResult> {
    if (!reference.trim())
      throw new CourierProviderError('Enter the Speedy tracking number.', 'rejected');
    if (!deliveryNumber.trim())
      throw new CourierProviderError('The Vista delivery reference is missing.', 'unavailable');

    const references = await this.findSpeedyReferences(deliveryNumber);
    if (!references.includes(reference))
      throw new CourierProviderError(
        'That Speedy tracking number does not match this Vista delivery.',
        'rejected',
      );
    const result = await this.speedyRequest(
      'track',
      {
        language: 'EN',
        parcels: references.map((fullBarcode) => ({ fullBarcode })),
        lastOperationOnly: false,
        userName: this.environment.LOGISTICS_SPEEDY_USERNAME,
        password: this.environment.LOGISTICS_SPEEDY_PASSWORD,
      },
      'track',
    );
    const parcels = Array.isArray(result['parcels']) ? result['parcels'] : [];
    const events = parcels.flatMap((parcelValue) => {
      const parcel = objectValue(parcelValue);
      const operations = Array.isArray(parcel?.['operations']) ? parcel.operations : [];
      return operations.flatMap((entry) => {
        const item = objectValue(entry);
        const description = stringValue(item?.['description']);
        const occurredAt = dateString(item?.['dateTime']);
        if (!description || !occurredAt) return [];
        const place = stringValue(item?.['place']);
        return [
          {
            description,
            occurredAt,
            ...(place ? { place } : {}),
            status: stringValue(item?.['operationCode']) ?? description,
          },
        ];
      });
    });
    if (!events.length)
      throw new CourierProviderError(
        `Speedy returned no tracking scans for shipment ${reference}.`,
        'unavailable',
      );
    const latest = events.reduce((current, item) =>
      item.occurredAt > current.occurredAt ? item : current,
    );
    return { events, providerStatus: latest.description };
  }

  private async findSpeedyReferences(deliveryNumber: string): Promise<string[]> {
    const result = await this.speedyRequest(
      'shipment/search',
      {
        ref: deliveryNumber,
        searchInRef: 1,
        shipmentsOnly: true,
      },
      'lookup',
    );
    const values = Array.isArray(result['barcodes']) ? result['barcodes'] : [];
    return [...new Set(values.map(stringValue).filter((value): value is string => Boolean(value)))];
  }

  private async econtRequest(
    path: string,
    payload: Record<string, unknown>,
    purpose: 'create' | 'track',
  ): Promise<Record<string, unknown>> {
    const credentials = Buffer.from(
      `${this.environment.LOGISTICS_ECONT_USERNAME}:${this.environment.LOGISTICS_ECONT_PASSWORD}`,
    ).toString('base64');
    const result = await requestJson(
      `${this.environment.LOGISTICS_ECONT_BASE_URL.replace(/\/+$/u, '')}/${path}`,
      payload,
      { authorization: `Basic ${credentials}` },
      purpose,
    );
    const error = providerErrorText(result);
    if (error) throw new CourierProviderError(error, 'rejected');
    return result;
  }

  private async speedyRequest(
    path: string,
    payload: Record<string, unknown>,
    purpose: 'create' | 'lookup' | 'track',
  ): Promise<Record<string, unknown>> {
    const request = {
      ...payload,
      userName: this.environment.LOGISTICS_SPEEDY_USERNAME,
      password: this.environment.LOGISTICS_SPEEDY_PASSWORD,
    };
    const result = await requestJson(
      `${this.environment.LOGISTICS_SPEEDY_BASE_URL.replace(/\/+$/u, '')}/${path}`,
      request,
      {},
      purpose,
    );
    const error = providerErrorText(result);
    if (error) throw new CourierProviderError(error, 'rejected');
    return result;
  }
}

async function requestJson(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  purpose: 'create' | 'lookup' | 'track',
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new CourierProviderError(
      'The courier service could not be reached. No repeat booking was attempted.',
      purpose === 'create' ? 'uncertain' : 'unavailable',
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CourierProviderError(
      'The courier returned an unreadable response. Check the provider account before retrying.',
      purpose === 'create' ? 'uncertain' : 'unavailable',
    );
  }
  const result = objectValue(payload);
  if (!result) {
    throw new CourierProviderError(
      'The courier returned an invalid response. Check the provider account before retrying.',
      purpose === 'create' ? 'uncertain' : 'unavailable',
    );
  }
  if (!response.ok) {
    const definiteRejection = response.status >= 400 && response.status < 500;
    throw new CourierProviderError(
      providerErrorText(result) ?? 'The courier rejected the request.',
      purpose === 'create' ? (definiteRejection ? 'rejected' : 'uncertain') : 'unavailable',
    );
  }
  return result;
}

function providerErrorText(value: Record<string, unknown>): string | undefined {
  const error = objectValue(value['error']);
  if (error)
    return 'The courier rejected the request. Review the recipient, address, parcel details, and configured service.';
  const message = stringValue(value['message']);
  if (message && (value['type'] === 'error' || value['success'] === false))
    return 'The courier rejected the request. Review the recipient, address, parcel details, and configured service.';
  return undefined;
}

function normalizeSpeedyPhone(value: string): string {
  return value.replace(/[()\-.]/gu, '').replace(/\s+/gu, '');
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function dateString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}
