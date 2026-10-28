import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultDatecsTaxGroups,
  emptyDatecsSaleSettings,
  isValidDatecsSaleSettings,
  readDatecsSaleSettings,
  saveDatecsSaleSettings,
} from './datecs-settings';

describe('DATECS sale settings', () => {
  beforeEach(() => localStorage.clear());

  it('provides the agreed editable VAT defaults and validates register details', () => {
    const settings = emptyDatecsSaleSettings('op01');

    expect(settings.operatorIdentifier).toBe('OP01');
    expect(settings.taxGroups).toEqual(defaultDatecsTaxGroups);
    expect(
      isValidDatecsSaleSettings({
        ...settings,
        deviceSerial: 'DT000600',
        operatorIdentifier: 'OP01',
      }),
    ).toBe(true);
    expect(isValidDatecsSaleSettings({ ...settings, deviceSerial: 'DT-600' })).toBe(false);
  });

  it('scopes settings to the cashier and register and never writes a printer password', () => {
    const settings = {
      ...emptyDatecsSaleSettings('OP01'),
      deviceSerial: 'DT000600',
      registerLocationNumber: 23,
    };

    saveDatecsSaleSettings('account-a', 'register-a', settings);
    expect(readDatecsSaleSettings('account-a', 'register-a')).toEqual(settings);
    expect(readDatecsSaleSettings('account-b', 'register-a').deviceSerial).toBe('');
    expect(localStorage.getItem('vista.pos.datecs.settings.v1:account-a:register-a')).not.toContain(
      'operatorPassword',
    );
  });

  it('falls back safely when browser storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage disabled');
    });

    expect(readDatecsSaleSettings('account-a', 'register-a', 'OP02')).toEqual(
      emptyDatecsSaleSettings('OP02'),
    );
    getItem.mockRestore();
  });
});
