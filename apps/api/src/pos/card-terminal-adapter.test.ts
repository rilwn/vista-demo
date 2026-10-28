import { describe, expect, it } from 'vitest';

import {
  DevelopmentCardTerminalSimulator,
  requireApprovedCardAuthorization,
  type CardAuthorizationCommand,
  type CardAuthorizationResult,
  type CardTerminalAdapter,
} from './card-terminal-adapter.js';

const command: CardAuthorizationCommand = {
  amountEur: '24.5000',
  cashRegisterId: 'register-1',
  idempotencyKey: 'pos-sale:transaction-1:card',
};

describe('POS card terminal adapter contract', () => {
  it('reuses one deterministic simulated approval for an identical retry', async () => {
    const adapter = new DevelopmentCardTerminalSimulator();

    const first = await requireApprovedCardAuthorization(adapter, command);
    const retry = await requireApprovedCardAuthorization(adapter, command);

    expect(first.adapter).toBe('development-card-simulator');
    expect(first.providerReference).toMatch(/^SIM-CARD-[A-F0-9]{24}$/u);
    expect(first.status).toBe('approved');
    expect(retry).toEqual(first);
  });

  it('rejects reuse of an idempotency key with a changed amount', async () => {
    const adapter = new DevelopmentCardTerminalSimulator();
    await adapter.authorize(command);

    await expect(adapter.authorize({ ...command, amountEur: '25.5000' })).rejects.toMatchObject({
      response: { code: 'POS_CARD_IDEMPOTENCY_CONFLICT' },
      status: 409,
    });
  });

  it('looks up a prior result without starting another card authorization', async () => {
    const adapter = new DevelopmentCardTerminalSimulator();

    expect(await adapter.reconcile(command)).toEqual({ status: 'not_found' });
    const first = await adapter.authorize(command);
    expect(await adapter.reconcile(command)).toEqual(first);
  });

  const nonApprovedResults: Array<{
    code: string;
    result: Exclude<CardAuthorizationResult, { status: 'approved' }>;
    status: number;
  }> = [
    {
      result: {
        adapter: 'test-terminal',
        code: 'DECLINED',
        message: 'Use another card.',
        status: 'declined',
      },
      code: 'POS_CARD_PAYMENT_DECLINED',
      status: 409,
    },
    {
      result: {
        adapter: 'test-terminal',
        message: 'Check the terminal.',
        status: 'uncertain',
      },
      code: 'POS_CARD_PAYMENT_OUTCOME_UNKNOWN',
      status: 503,
    },
  ];

  it.each(nonApprovedResults)(
    'does not treat $result.status as an approved payment',
    async ({ code, result, status }) => {
      const adapter: CardTerminalAdapter = {
        authorize: () => Promise.resolve(result),
        reconcile: () => Promise.resolve({ status: 'not_found' }),
      };

      await expect(requireApprovedCardAuthorization(adapter, command)).rejects.toMatchObject({
        response: { code },
        status,
      });
    },
  );
});
