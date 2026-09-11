import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { AllowPasswordChangeRequired } from './decorators/allow-password-change-required.decorator.js';
import { AuthResponse, MessageResponse } from './dto/auth.response.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { TrustedOriginGuard } from './guards/trusted-origin.guard.js';
import { NotificationJobsService } from '../notifications/notification-jobs.service.js';

@ApiTags('auth')
@UseGuards(TrustedOriginGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly notificationJobs: NotificationJobsService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a customer account' })
  @ApiCreatedResponse({ type: AuthResponse })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
    return this.publicAuthResult(result);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  @ApiOperation({ summary: 'Authenticate with email and password' })
  @ApiOkResponse({ type: AuthResponse })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto);
    this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
    return this.publicAuthResult(result);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Rotate refresh session and issue a new access token' })
  @ApiOkResponse({ type: AuthResponse })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.refresh(this.getRefreshToken(request));
    this.setRefreshCookie(response, result.refreshToken, result.refreshTokenExpiresAt);
    return this.publicAuthResult(result);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke the current refresh session' })
  @ApiOkResponse({ type: MessageResponse })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageResponse> {
    await this.authService.logout(this.getRefreshToken(request));
    this.clearRefreshCookie(response);
    return { message: 'Signed out successfully' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  @ApiOperation({ summary: 'Create a one-time password reset request' })
  @ApiOkResponse({ type: MessageResponse })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageResponse> {
    const result = await this.authService.requestPasswordReset(dto);
    if (result.delivery) await this.notificationJobs.enqueuePasswordReset(result.delivery);
    return { message: result.message };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  @ApiOperation({ summary: 'Reset password with a one-time token' })
  @ApiOkResponse({ type: MessageResponse })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponse> {
    await this.authService.resetPassword(dto);
    return { message: 'Password reset successfully' };
  }

  @ApiBearerAuth()
  @AllowPasswordChangeRequired()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  @ApiOperation({ summary: 'Change the authenticated user password' })
  @ApiOkResponse({ type: MessageResponse })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageResponse> {
    await this.authService.changePassword(user.id, dto);
    this.clearRefreshCookie(response);
    return { message: 'Password changed. Please sign in again' };
  }

  private publicAuthResult(result: Awaited<ReturnType<AuthService['login']>>): AuthResponse {
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  private getRefreshToken(request: Request): string | undefined {
    const token: unknown = request.cookies?.[this.cookieName];
    return typeof token === 'string' ? token : undefined;
  }

  private setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
    response.cookie(this.cookieName, token, {
      ...this.cookieOptions,
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(this.cookieName, this.cookieOptions);
  }

  private get cookieName(): string {
    return this.configService.getOrThrow<string>('REFRESH_COOKIE_NAME');
  }

  private get cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.getOrThrow<string>('NODE_ENV') === 'production',
      sameSite: this.configService.getOrThrow<'lax' | 'strict' | 'none'>(
        'REFRESH_COOKIE_SAME_SITE',
      ),
      path: '/api/v1/auth',
    };
  }
}
