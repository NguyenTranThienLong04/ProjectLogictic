import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ClientContext } from '../auth/auth.types.js';
import type { Request } from 'express';
import { AllowPasswordChangeRequired } from '../auth/decorators/allow-password-change-required.decorator.js';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { SetUserStatusDto } from './dto/set-user-status.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { UserResponse } from './user.response.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @AllowPasswordChangeRequired()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiOkResponse({ type: UserResponse })
  getProfile(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.usersService.getProfile(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  @ApiOkResponse({ type: UserResponse })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponse> {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Post('staff')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a staff account (admin only)' })
  @ApiCreatedResponse({ type: UserResponse })
  createStaff(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: CreateStaffDto,
    @Req() request: Request,
  ): Promise<UserResponse> {
    const context: ClientContext = {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
    return this.usersService.createStaff(actor, dto, context);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List users with admin-only pagination, search, and filters' })
  @ApiOkResponse({ description: 'Paginated users without authentication secrets' })
  list(@Query() query: ListUsersDto) {
    return this.usersService.list(query);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Suspend or restore a user account with audit history' })
  @ApiOkResponse({ type: UserResponse })
  setStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: SetUserStatusDto,
    @Req() request: Request,
  ): Promise<UserResponse> {
    return this.usersService.setStatus(actor, userId, dto.status, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }
}
