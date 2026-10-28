import { Inject, Injectable } from '@nestjs/common';
import type { AppEnvironment } from '@vista/config';
import { UnrecoverableError } from 'bullmq';

import { APP_ENVIRONMENT } from '../config/config.module.js';

@Injectable()
export class SmsGatewayService {
  constructor(@Inject(APP_ENVIRONMENT) private readonly environment: AppEnvironment) {}

  async send(input: { body: string; to: string }): Promise<void> {
    if (this.environment.SMS_PROVIDER !== 'twilio') {
      throw new UnrecoverableError('SMS delivery is not configured for this environment');
    }
    if (
      !/^\+[1-9][0-9]{7,14}$/u.test(input.to) ||
      !input.body.trim() ||
      input.body.length > 1_600
    ) {
      throw new UnrecoverableError('The queued SMS has invalid delivery details');
    }

    const form = new URLSearchParams({ To: input.to, Body: input.body });
    if (this.environment.TWILIO_MESSAGING_SERVICE_SID) {
      form.set('MessagingServiceSid', this.environment.TWILIO_MESSAGING_SERVICE_SID);
    } else {
      form.set('From', this.environment.TWILIO_FROM_NUMBER);
    }
    const accountSid = this.environment.TWILIO_ACCOUNT_SID;
    const credentials = Buffer.from(
      `${this.environment.TWILIO_API_KEY_SID}:${this.environment.TWILIO_API_KEY_SECRET}`,
    ).toString('base64');
    const endpoint = new URL(
      `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      this.environment.TWILIO_API_BASE_URL,
    );

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('SMS_PROVIDER_CONNECTION_FAILED');
    }

    if (!response.ok) {
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new UnrecoverableError('The SMS provider rejected the notification');
      }
      throw new Error('SMS_PROVIDER_TEMPORARY_FAILURE');
    }
  }
}
