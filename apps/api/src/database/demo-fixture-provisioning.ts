export function assertDemoFixtureProvisioningIsAllowed(environment: NodeJS.ProcessEnv): void {
  if (environment['VISTA_DEPLOYMENT_STAGE'] !== 'staging') {
    throw new Error('Demo fixtures can be provisioned only when VISTA_DEPLOYMENT_STAGE=staging.');
  }
  if (environment['DEMO_FIXTURES_PROVISIONING_ENABLED'] !== 'true') {
    throw new Error(
      'Set DEMO_FIXTURES_PROVISIONING_ENABLED=true only for the controlled demo-fixture provisioning run.',
    );
  }
}
