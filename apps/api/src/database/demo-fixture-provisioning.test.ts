import { describe, expect, it } from 'vitest';

import { assertDemoFixtureProvisioningIsAllowed } from './demo-fixture-provisioning.js';

describe('assertDemoFixtureProvisioningIsAllowed', () => {
  it('allows only an explicitly enabled staging provisioning run', () => {
    expect(() =>
      assertDemoFixtureProvisioningIsAllowed({
        DEMO_FIXTURES_PROVISIONING_ENABLED: 'true',
        VISTA_DEPLOYMENT_STAGE: 'staging',
      }),
    ).not.toThrow();
  });

  it('rejects a run outside staging', () => {
    expect(() =>
      assertDemoFixtureProvisioningIsAllowed({
        DEMO_FIXTURES_PROVISIONING_ENABLED: 'true',
        VISTA_DEPLOYMENT_STAGE: 'production',
      }),
    ).toThrow('VISTA_DEPLOYMENT_STAGE=staging');
  });

  it('requires an explicit opt-in', () => {
    expect(() =>
      assertDemoFixtureProvisioningIsAllowed({ VISTA_DEPLOYMENT_STAGE: 'staging' }),
    ).toThrow('DEMO_FIXTURES_PROVISIONING_ENABLED=true');
  });
});
