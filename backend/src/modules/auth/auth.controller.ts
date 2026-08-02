import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { randomBytes } from 'node:crypto';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUserId } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';

const LOGIN_RATE_LIMIT = { default: { limit: 5, ttl: 15 * 60 * 1000 } };

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(LOGIN_RATE_LIMIT)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<{ success: true; user: { id: string; email: string; name: string } }> {
    const ip = request.ip ?? 'unknown';
    const user = await this.authService.validateCredentials(dto.email, dto.password, ip);

    // Security decision #1: regenerate the session id BEFORE writing any
    // session data, to prevent session fixation (an attacker who set/knew
    // the pre-login session id must not be able to ride it into an
    // authenticated session).
    await this.regenerateSession(request);

    request.session.userId = user.id;
    request.session.userEmail = user.email;
    request.session.csrfToken = randomBytes(32).toString('hex');

    await this.saveSession(request);

    return { success: true, user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard)
  async logout(@Req() request: Request, @CurrentUserId() userId: string): Promise<void> {
    this.auditLog.record({
      actor: userId,
      action: 'auth.logout',
      result: 'success',
      ip: request.ip,
    });
    await this.destroySession(request);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentUserId() userId: string): Promise<{ id: string; email: string; name: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { id: user.id, email: user.email, name: user.name };
  }

  /** Issues (or re-issues) the CSRF token an authenticated client must echo back via the x-csrf-token header on mutating requests. */
  @Get('csrf')
  @UseGuards(SessionAuthGuard)
  csrf(@Req() request: Request): { csrfToken: string } {
    if (!request.session.csrfToken) {
      request.session.csrfToken = randomBytes(32).toString('hex');
    }
    return { csrfToken: request.session.csrfToken };
  }

  private regenerateSession(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
  }

  private saveSession(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.save((err) => (err ? reject(err) : resolve()));
    });
  }

  private destroySession(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.destroy((err) => (err ? reject(err) : resolve()));
    });
  }
}
