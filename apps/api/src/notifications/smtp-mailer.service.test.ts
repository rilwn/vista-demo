import { describe, expect, it } from 'vitest';

import { serializeSmtpMessage } from './smtp-mailer.service.js';

describe('serializeSmtpMessage', () => {
  it('creates a bilingual MIME email with an encoded PDF attachment', () => {
    const message = serializeSmtpMessage(
      {
        attachment: {
          content: Buffer.from('%PDF-test'),
          fileName: 'INV-0000000001.pdf',
          mediaType: 'application/pdf',
        },
        messageId: 'stable-message-id@vista.local',
        subject: 'Invoice / Фактура',
        text: 'Your invoice is attached. / Прикачена е фактурата.',
        to: 'client@example.com',
      },
      'no-reply@vista.local',
    );

    expect(message).toContain('To: <client@example.com>');
    expect(message).toContain('Message-ID: <stable-message-id@vista.local>');
    expect(message).toContain('Content-Type: multipart/mixed;');
    expect(message).toContain("filename*=UTF-8''INV-0000000001.pdf");
    expect(message).toContain(Buffer.from('%PDF-test').toString('base64'));
    const encodedText = Buffer.from(
      'Your invoice is attached. / Прикачена е фактурата.',
      'utf8',
    ).toString('base64');
    expect(message).toContain(`${encodedText.slice(0, 76)}\r\n${encodedText.slice(76)}`);
    expect(message).toContain(Buffer.from('Invoice / Фактура', 'utf8').toString('base64'));
  });

  it('rejects header injection and oversized attachments', () => {
    const base = {
      messageId: 'stable-message-id@vista.local',
      subject: 'Invoice',
      text: 'Invoice attached.',
      to: 'client@example.com',
    };
    expect(() =>
      serializeSmtpMessage(
        { ...base, to: 'client@example.com\r\nBcc:other@example.com' },
        'no-reply@vista.local',
      ),
    ).toThrow('Invalid email to.');
    expect(() =>
      serializeSmtpMessage(
        {
          ...base,
          attachment: {
            content: Buffer.alloc(8 * 1024 * 1024 + 1),
            fileName: 'large.pdf',
            mediaType: 'application/pdf',
          },
        },
        'no-reply@vista.local',
      ),
    ).toThrow('Email attachment exceeds the eight-megabyte limit.');
  });
});
