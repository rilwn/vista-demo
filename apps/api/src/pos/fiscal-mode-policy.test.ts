import { describe, expect, it } from 'vitest';

import { canUseFiscalSimulator } from './fiscal-mode-policy.js';

describe('POS fiscal simulator policy', () => {
  it('allows the simulator in local development', () => {
    expect(
      canUseFiscalSimulator({
        NODE_ENV: 'development',
        POS_FISCAL_SIMULATOR_ENABLED: false,
        VISTA_DEPLOYMENT_STAGE: 'local',
      }),
    ).toBe(true);
  });

  it('allows a production build to use the simulator only when staging explicitly enables it', () => {
    expect(
      canUseFiscalSimulator({
        NODE_ENV: 'production',
        POS_FISCAL_SIMULATOR_ENABLED: true,
        VISTA_DEPLOYMENT_STAGE: 'staging',
      }),
    ).toBe(true);
    expect(
      canUseFiscalSimulator({
        NODE_ENV: 'production',
        POS_FISCAL_SIMULATOR_ENABLED: false,
        VISTA_DEPLOYMENT_STAGE: 'staging',
      }),
    ).toBe(false);
  });

  it('never allows the simulator in the production deployment stage', () => {
    expect(
      canUseFiscalSimulator({
        NODE_ENV: 'development',
        POS_FISCAL_SIMULATOR_ENABLED: true,
        VISTA_DEPLOYMENT_STAGE: 'production',
      }),
    ).toBe(false);
  });

  it('keeps a production build without a staging designation blocked', () => {
    expect(
      canUseFiscalSimulator({
        NODE_ENV: 'production',
        POS_FISCAL_SIMULATOR_ENABLED: false,
        VISTA_DEPLOYMENT_STAGE: 'local',
      }),
    ).toBe(false);
  });
});
