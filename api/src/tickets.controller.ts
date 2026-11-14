import { Body, Controller, Get, Inject, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from './auth.js';
import { CATEGORIES, PRIORITIES, STATUSES } from './domain.js';
import { TicketsService } from './tickets.service.js';

const ListQuery = z.object({
  status: z.enum(STATUSES).optional(),
  assigned: z.enum(['me', 'none']).optional(),
  q: z.string().max(100).optional(),
});
const CreateBody = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(5000),
});
const StatusBody = z.object({ status: z.enum(STATUSES) });
const UpdateBody = z
  .object({
    priority: z.enum(PRIORITIES).optional(),
    category: z.enum(CATEGORIES).optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
const CommentBody = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().optional() });

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly svc: TicketsService) {}

  @Get()
  list(@CurrentUser() me: AuthUser, @Query({ schema: ListQuery }) q: z.infer<typeof ListQuery>) {
    return this.svc.list(me, q);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body({ schema: CreateBody }) body: z.infer<typeof CreateBody>) {
    return this.svc.create(me, body);
  }

  @Get(':id')
  get(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id, me);
  }

  @Patch(':id/status')
  status(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body({ schema: StatusBody }) body: z.infer<typeof StatusBody>,
  ) {
    return this.svc.changeStatus(id, me, body.status);
  }

  @Roles('agent', 'admin')
  @Post(':id/claim')
  claim(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.claim(id, me);
  }

  @Roles('agent', 'admin')
  @Patch(':id')
  update(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body({ schema: UpdateBody }) body: z.infer<typeof UpdateBody>,
  ) {
    return this.svc.update(id, me, body);
  }

  @Post(':id/comments')
  comment(
    @CurrentUser() me: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body({ schema: CommentBody }) body: z.infer<typeof CommentBody>,
  ) {
    return this.svc.addComment(id, me, body);
  }

  @Roles('agent', 'admin')
  @Post(':id/triage')
  retriage(@CurrentUser() me: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.svc.retriage(id, me);
  }
}

@ApiTags('meta')
@ApiBearerAuth()
@Controller()
export class MetaController {
  constructor(@Inject(TicketsService) private readonly svc: TicketsService) {}

  @Roles('agent', 'admin')
  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Roles('agent', 'admin')
  @Get('agents')
  agents() {
    return this.svc.agents();
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }
}
