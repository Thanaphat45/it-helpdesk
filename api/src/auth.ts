import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Post,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { z } from 'zod';
import type { Role } from './domain.js';
import { User } from './entities.js';

export interface AuthUser {
  id: number;
  role: Role;
  name: string;
}

const PUBLIC = 'isPublic';
const ROLES_KEY = 'roles';
export const Public = () => SetMetadata(PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** Global guard: every route needs a valid token unless marked @Public, then @Roles is enforced. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      const p = await this.jwt.verifyAsync<{ sub: number; role: Role; name: string }>(token);
      req.user = { id: p.sub, role: p.role, name: p.name } satisfies AuthUser;
    } catch {
      throw new UnauthorizedException();
    }

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(req.user.role)) throw new ForbiddenException();
    return true;
  }
}

const LoginBody = z.object({ email: z.email(), password: z.string().min(1) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body({ schema: LoginBody }) body: z.infer<typeof LoginBody>) {
    const user = await this.users.findOne({
      where: { email: body.email.toLowerCase() },
      select: { id: true, name: true, email: true, role: true, department: true, passwordHash: true },
    });
    // Same error and roughly the same work whether or not the email exists.
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    if (!user || !ok) throw new UnauthorizedException('Email or password is incorrect');
    const { passwordHash: _, ...safe } = user;
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role, name: user.name });
    return { token, user: safe };
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() me: AuthUser) {
    return this.users.findOneByOrFail({ id: me.id });
  }
}
