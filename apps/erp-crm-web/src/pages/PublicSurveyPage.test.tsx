import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalizationProvider } from '../i18n/LocalizationProvider';
import { PublicSurveyPage } from './PublicSurveyPage';

describe('PublicSurveyPage', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/survey/test-token?lang=en');
  });

  it('loads and submits a public response without an employee session', async () => {
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
        void options;
        if (requestUrl(input).includes('/crm/public-surveys/test-token/response'))
          return Promise.resolve(
            jsonResponse({
              expiresAt: '2026-12-31T00:00:00.000Z',
              number: 'SUR-2026-000001',
              score: 10,
              sourceKind: 'service',
              status: 'responded',
            }),
          );
        return Promise.resolve(
          jsonResponse({
            expiresAt: '2026-12-31T00:00:00.000Z',
            number: 'SUR-2026-000001',
            sourceKind: 'service',
            status: 'awaiting_response',
          }),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LocalizationProvider>
        <PublicSurveyPage token="test-token" />
      </LocalizationProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Customer feedback' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '10' }));
    fireEvent.change(screen.getByLabelText('Anything else you would like us to know? (optional)'), {
      target: { value: 'The technician was helpful.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send response' }));

    expect(await screen.findByText('Thank you. Your response has been recorded.')).toBeTruthy();
    const submission = fetchMock.mock.calls.find(([url]) =>
      requestUrl(url).includes('/crm/public-surveys/test-token/response'),
    );
    expect(submission?.[1]).toMatchObject({
      credentials: 'omit',
      method: 'POST',
    });
    expect(new Headers(submission?.[1]?.headers).has('authorization')).toBe(false);
    const requestBody = submission?.[1]?.body;
    if (typeof requestBody !== 'string') throw new Error('Expected a JSON response body.');
    expect(JSON.parse(requestBody)).toEqual({
      comment: 'The technician was helpful.',
      score: 10,
    });
  });

  it('shows an expired link in Bulgarian', async () => {
    window.history.replaceState({}, '', '/survey/test-token?lang=bg');
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            expiresAt: '2026-01-01T00:00:00.000Z',
            number: 'SUR-2026-000001',
            sourceKind: 'delivery',
            status: 'expired',
          }),
        ),
      ),
    );

    render(
      <LocalizationProvider>
        <PublicSurveyPage token="test-token" />
      </LocalizationProvider>,
    );

    expect(
      await screen.findByText(
        'Връзката към анкетата е изтекла. Свържете се с Vista Service за нова връзка.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Изпрати отговор' })).toBeNull();
  });

  it('loads and records a Bulgarian response', async () => {
    window.history.replaceState({}, '', '/survey/test-token?lang=bg');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL): Promise<Response> =>
        Promise.resolve(
          jsonResponse(
            requestUrl(input).endsWith('/response')
              ? {
                  expiresAt: '2026-12-31T00:00:00.000Z',
                  number: 'SUR-2026-000002',
                  score: 9,
                  sourceKind: 'service',
                  status: 'responded',
                }
              : {
                  expiresAt: '2026-12-31T00:00:00.000Z',
                  number: 'SUR-2026-000002',
                  sourceKind: 'service',
                  status: 'awaiting_response',
                },
          ),
        ),
      ),
    );

    render(
      <LocalizationProvider>
        <PublicSurveyPage token="test-token" />
      </LocalizationProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Обратна връзка от клиент' })).toBeTruthy();
    expect(screen.getByText('Оценете обслужването на Vista Service.')).toBeTruthy();
    expect(screen.getByText('Сервиз')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: 'Изпрати отговор' }));

    expect(await screen.findByText('Благодарим. Отговорът ви е записан.')).toBeTruthy();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}
