import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from './modules/auth/decorators/public.decorator.js';

class FoundationResponse {
  name!: string;
  version!: string;
}

@ApiTags('foundation')
@Public()
@Controller()
export class AppController {
  @Get()
  @ApiOperation({ summary: 'Return API identity' })
  @ApiOkResponse({ type: FoundationResponse })
  getApiIdentity(): FoundationResponse {
    return {
      name: 'Logistics API',
      version: 'v1',
    };
  }
}
