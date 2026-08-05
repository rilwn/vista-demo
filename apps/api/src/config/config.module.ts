import { Global, Module } from '@nestjs/common';
import { parseEnvironment, type AppEnvironment } from '@vista/config';

export const APP_ENVIRONMENT = Symbol('APP_ENVIRONMENT');

@Global()
@Module({
  exports: [APP_ENVIRONMENT],
  providers: [
    {
      provide: APP_ENVIRONMENT,
      useFactory: (): AppEnvironment => parseEnvironment(process.env),
    },
  ],
})
export class VistaConfigModule {}
