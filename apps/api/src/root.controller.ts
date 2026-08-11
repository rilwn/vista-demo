import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';

import { Public } from './auth/auth.decorators.js';
import { RateLimitPolicy } from './security/rate-limit.decorator.js';

class PlatformIdentificationDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  phase!: string;

  @ApiProperty({ enum: ['in-progress'] })
  status!: 'in-progress';
}

@ApiTags('platform')
@RateLimitPolicy('public')
@Public()
@Controller()
export class RootController {
  @Get()
  @ApiOkResponse({
    description: 'Identifies the Vista API and its current delivery state.',
    type: PlatformIdentificationDto,
  })
  identify(): PlatformIdentificationDto {
    return {
      name: 'Vista Integrated Information System API',
      phase: 'Phase 1 — Platform foundation',
      status: 'in-progress',
    };
  }
}
