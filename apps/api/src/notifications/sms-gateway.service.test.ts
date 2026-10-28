import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnrecoverableError } from 'bullmq';

import type { AppEnvironment } from '@vista/config';
import { SmsGatewayService } from './sms-gateway.service.js';

describe('SmsGatewayService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a queued SMS through Twilio without exposing credentials in the URL', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetch);
    const service = new SmsGatewayService(environment());

    await service.send({ body: 'Backup verified · DB-DAILY', to: '+359888123456' });

    const [url, request] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json',
    );
    expect(request.method).toBe('POST');
    expect(request.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from('SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:twilio-test-key-secret').toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(request.body).toBeInstanceOf(URLSearchParams);
    const form = request.body as URLSearchParams;
    expect(form.get('To')).toBe('+359888123456');
    expect(form.get('MessagingServiceSid')).toBe('MGcccccccccccccccccccccccccccccccc');
    expect(form.get('Body')).toBe('Backup verified · DB-DAILY');
  });

  it('treats provider throttling and server faults as retryable', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal('fetch', fetch);
    const service = new SmsGatewayService(environment());

    await expect(service.send({ body: 'Check backup', to: '+359888123456' })).rejects.toThrow(
      'SMS_PROVIDER_TEMPORARY_FAILURE',
    );
  });

  it('does not retry rejected messages or unconfigured SMS delivery', async () => {
    const rejectedFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal('fetch', rejectedFetch);
    const service = new SmsGatewayService(environment());
    await expect(
      service.send({ body: 'Check backup', to: '+359888123456' }),
    ).rejects.toBeInstanceOf(UnrecoverableError);

    const disabled = new SmsGatewayService({ SMS_PROVIDER: 'disabled' } as AppEnvironment);
    await expect(
      disabled.send({ body: 'Check backup', to: '+359888123456' }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(rejectedFetch).toHaveBeenCalledOnce();
  });
});

function environment(): AppEnvironment {
  return {
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY_SID: `SK${'b'.repeat(32)}`,
    TWILIO_API_KEY_SECRET: 'twilio-test-key-secret',
    TWILIO_API_BASE_URL: 'https://api.twilio.com',
    TWILIO_FROM_NUMBER: '',
    TWILIO_MESSAGING_SERVICE_SID: `MG${'c'.repeat(32)}`,
  } as AppEnvironment;
}
