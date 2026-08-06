import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from './auth/auth.decorators.js';

@ApiTags('platform')
@Public()
@Controller()
export class RootController {
  @Get()
  @ApiOkResponse({ description: 'Identifies the Vista API and its current delivery state.' })
  identify(): { name: string; phase: string; status: string } {
    return {
      name: 'Vista Integrated Information System API',
      phase: 'Phase 1 — Platform foundation',
      status: 'in-progress',
    };
  }
}
