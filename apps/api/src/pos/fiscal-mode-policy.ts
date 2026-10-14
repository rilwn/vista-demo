import type { AppEnvironment } from '@vista/config';

export function canUseFiscalSimulator(
  environment: Pick<
    AppEnvironment,
    'NODE_ENV' | 'POS_FISCAL_SIMULATOR_ENABLED' | 'VISTA_DEPLOYMENT_STAGE'
  >,
): boolean {
  if (environment.VISTA_DEPLOYMENT_STAGE === 'production') return false;
  if (environment.VISTA_DEPLOYMENT_STAGE === 'staging')
    return environment.POS_FISCAL_SIMULATOR_ENABLED;
  return environment.NODE_ENV !== 'production';
}
