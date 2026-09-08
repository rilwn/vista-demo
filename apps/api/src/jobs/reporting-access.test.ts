import { describe, expect, it } from 'vitest';
import type { Permission, PermissionModule } from '@vista/auth';
import { reportingScopes } from '@vista/contracts';
import { canReport, reportAccess } from './reporting-access.js';
describe('report library domain permissions', () => {
  it.each(reportingScopes)('preserves %s read/write boundaries', (scope) => {
    const module: PermissionModule = scope === 'pos' || scope === 'crm' ? scope : `erp.${scope}`;
    const read: Permission = { module, action: scope === 'service' ? 'approve' : 'view' };
    expect(canReport({ permissions: [read] }, scope)).toBe(true);
    expect(canReport({ permissions: [read] }, scope, true)).toBe(false);
    expect(canReport({ permissions: [read, { module, action: 'create' }] }, scope, true)).toBe(
      true,
    );
    expect(() =>
      reportAccess({ permissions: [{ module: 'reports', action: 'view' }] }, scope),
    ).toThrow();
  });
  it('does not expose all technician work through ordinary Service view', () => {
    expect(
      canReport(
        {
          permissions: [
            { module: 'erp.service', action: 'view' },
            { module: 'erp.service', action: 'create' },
          ],
        },
        'service',
      ),
    ).toBe(false);
  });
});
