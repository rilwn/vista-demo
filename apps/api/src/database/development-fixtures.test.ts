import { describe, expect, it } from 'vitest';

import {
  developmentFixtureAccounts,
  developmentFixturePartnerIbans,
  developmentFixtureProductBarcodes,
  fixtureId,
  isLocalDevelopmentDatabase,
} from './development-fixtures.js';

describe('development fixtures', () => {
  it('uses stable identities for the complete local application account matrix', () => {
    const emails = developmentFixtureAccounts.map(({ email }) => email);
    const employeeNumbers = developmentFixtureAccounts.map(({ employeeNumber }) => employeeNumber);
    const roleCodes = developmentFixtureAccounts.map(({ roleCode }) => roleCode);

    expect(developmentFixtureAccounts).toHaveLength(12);
    expect(new Set(emails).size).toBe(emails.length);
    expect(new Set(employeeNumbers).size).toBe(employeeNumbers.length);
    expect(new Set(roleCodes).size).toBe(roleCodes.length);
    expect(emails).toContain('dispatcher@vista.local');
    expect(emails).toContain('technician@vista.local');
    expect(emails).toContain('pos.operator@vista.local');
    expect(emails).toContain('backup.operator@vista.local');
    expect(
      developmentFixtureAccounts.find((account) => account.key === 'pos-operator')?.permissions,
    ).toEqual([
      { action: 'view', module: 'pos' },
      { action: 'create', module: 'pos' },
      { action: 'edit', module: 'pos' },
    ]);
    expect(
      developmentFixtureAccounts.find((account) => account.key === 'backup-operator')?.permissions,
    ).toEqual([{ action: 'view', module: 'backup' }]);
    expect(
      developmentFixtureAccounts
        .find((account) => account.key === 'manager')
        ?.permissions.some(
          (permission) =>
            permission.module === 'platform' &&
            (permission.action === 'create' || permission.action === 'approve'),
        ),
    ).toBe(false);
    expect(
      developmentFixtureAccounts
        .find((account) => account.key === 'manager')
        ?.permissions.some(
          (permission) => permission.module === 'pos' && permission.action === 'approve',
        ),
    ).toBe(true);
    expect(
      developmentFixtureAccounts
        .find((account) => account.key === 'viewer')
        ?.permissions.some((permission) => permission.module === 'platform'),
    ).toBe(false);
    expect(
      developmentFixtureAccounts
        .find((account) => account.key === 'viewer')
        ?.permissions.some((permission) => permission.module === 'erp.service'),
    ).toBe(false);
    expect(fixtureId('account:manager')).toBe(fixtureId('account:manager'));
    expect(fixtureId('account:manager')).not.toBe(fixtureId('account:technician'));
  });

  it('only accepts explicitly local PostgreSQL hosts for fixture data', () => {
    expect(isLocalDevelopmentDatabase('postgresql://vista:secret@localhost:55432/vista')).toBe(
      true,
    );
    expect(isLocalDevelopmentDatabase('postgresql://vista:secret@127.0.0.1:55432/vista')).toBe(
      true,
    );
    expect(isLocalDevelopmentDatabase('postgresql://vista:secret@postgres:5432/vista')).toBe(false);
    expect(isLocalDevelopmentDatabase('postgres://vista:secret@localhost:55432/vista')).toBe(false);
    expect(isLocalDevelopmentDatabase('postgresql://vista:secret@db.example.com:5432/vista')).toBe(
      false,
    );
    expect(isLocalDevelopmentDatabase('not a connection URL')).toBe(false);
  });

  it('uses EAN-13 and IBAN fixtures that pass the same basic checks as normal data', () => {
    expect(developmentFixtureProductBarcodes.every(isValidEan13)).toBe(true);
    expect(developmentFixturePartnerIbans.every(isValidIban)).toBe(true);
  });
});

function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  const sum = value
    .slice(0, -1)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(value.at(-1));
}

function isValidIban(iban: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/u.test(iban)) return false;
  let remainder = 0;
  for (const character of `${iban.slice(4)}${iban.slice(0, 4)}`) {
    const digits = /[A-Z]/u.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
