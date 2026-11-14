import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { AuthUser } from './auth.js';
import {
  canTransition,
  isOverdue,
  nextStatuses,
  slaDueAt,
  STATUSES,
  type Category,
  type Priority,
  type Status,
} from './domain.js';
import { Comment, Ticket, User } from './entities.js';
import { TriageService } from './triage.service.js';

const isStaff = (u: AuthUser) => u.role === 'agent' || u.role === 'admin';

export interface ListQuery {
  status?: Status;
  assigned?: 'me' | 'none';
  q?: string;
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(TriageService) private readonly triageService: TriageService,
  ) {}

  /** Adds fields the client needs but the table does not store. */
  private view(t: Ticket, me: AuthUser) {
    const staff = isStaff(me);
    return {
      ...t,
      code: `HD-${String(t.id).padStart(4, '0')}`,
      overdue: isOverdue(t),
      nextStatuses: nextStatuses(t.status, me.role, t.requester.id === me.id),
      // The AI draft is a tool for staff, not something the requester should see.
      aiSuggestedReply: staff ? t.aiSuggestedReply : null,
    };
  }

  async list(me: AuthUser, q: ListQuery) {
    const qb = this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.requester', 'r')
      .leftJoinAndSelect('t.assignee', 'a')
      .orderBy('t.createdAt', 'DESC')
      .take(200);
    if (!isStaff(me)) qb.andWhere('r.id = :me', { me: me.id });
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.assigned === 'me') qb.andWhere('a.id = :me', { me: me.id });
    if (q.assigned === 'none') qb.andWhere('t.assignee IS NULL');
    if (q.q) qb.andWhere('(LOWER(t.title) LIKE :q OR LOWER(t.description) LIKE :q)', { q: `%${q.q.toLowerCase()}%` });
    const rows = await qb.getMany();
    return rows.map((t) => this.view(t, me));
  }

  private async load(id: number, me: AuthUser): Promise<Ticket> {
    const t = await this.tickets.findOneBy({ id });
    // A requester gets 404, not 403, for someone else's ticket, so ids cannot be probed.
    if (!t || (!isStaff(me) && t.requester.id !== me.id)) throw new NotFoundException('Ticket not found');
    return t;
  }

  async get(id: number, me: AuthUser) {
    const t = await this.load(id, me);
    const comments = await this.comments.find({
      where: { ticket: { id }, ...(isStaff(me) ? {} : { internal: false }) },
      order: { createdAt: 'ASC' },
    });
    return { ...this.view(t, me), comments };
  }

  async create(me: AuthUser, body: { title: string; description: string }) {
    const triage = await this.triageService.triage(body.title, body.description);
    const now = new Date();
    const t = await this.tickets.save(
      this.tickets.create({
        title: body.title,
        description: body.description,
        category: triage.category,
        priority: triage.priority,
        status: 'open',
        requester: { id: me.id } as User,
        assignee: null,
        aiSummary: triage.summary,
        aiSuggestedReply: triage.suggestedReply || null,
        triageSource: triage.source,
        slaDueAt: slaDueAt(triage.priority, now),
        resolvedAt: null,
      }),
    );
    return this.get(t.id, me);
  }

  async changeStatus(id: number, me: AuthUser, to: Status) {
    const t = await this.load(id, me);
    if (!canTransition(t.status, to, me.role, t.requester.id === me.id)) {
      throw new BadRequestException(`Cannot move a ticket from ${t.status} to ${to}`);
    }
    t.status = to;
    if (to === 'resolved') t.resolvedAt = new Date();
    if (to === 'in_progress') t.resolvedAt = null;
    if (to === 'in_progress' && !t.assignee && isStaff(me)) t.assignee = { id: me.id } as User;
    await this.tickets.save(t);
    return this.get(id, me);
  }

  /**
   * "Take" an unassigned ticket. Two agents can click at the same moment, so the
   * check and the write are one conditional UPDATE: only one of them changes a row.
   */
  async claim(id: number, me: AuthUser) {
    await this.load(id, me);
    const res = await this.tickets
      .createQueryBuilder()
      .update(Ticket)
      .set({ assignee: { id: me.id } })
      .where('id = :id', { id })
      .andWhere('"assigneeId" IS NULL')
      .execute();
    if (!res.affected) throw new ConflictException('Someone else already took this ticket');
    return this.get(id, me);
  }

  async update(id: number, me: AuthUser, body: { priority?: Priority; category?: Category; assigneeId?: number | null }) {
    const t = await this.load(id, me);
    if (body.assigneeId !== undefined) {
      if (body.assigneeId === null) t.assignee = null;
      else {
        const agent = await this.users.findOneBy({ id: body.assigneeId, role: In(['agent', 'admin']) });
        if (!agent) throw new BadRequestException('Assignee must be an IT staff member');
        t.assignee = agent;
      }
    }
    if (body.category) t.category = body.category;
    if (body.priority && body.priority !== t.priority) {
      t.priority = body.priority;
      t.slaDueAt = slaDueAt(body.priority, t.createdAt); // SLA always counts from when the ticket was filed
    }
    await this.tickets.save(t);
    return this.get(id, me);
  }

  async addComment(id: number, me: AuthUser, body: { body: string; internal?: boolean }) {
    const t = await this.load(id, me);
    if (t.status === 'closed') throw new BadRequestException('Ticket is closed');
    if (body.internal && !isStaff(me)) throw new ForbiddenException('Only IT staff can write internal notes');
    await this.comments.save(
      this.comments.create({ ticket: { id }, author: { id: me.id } as User, body: body.body, internal: !!body.internal }),
    );
    // When the requester answers a question, the ticket comes back to the queue.
    if (t.status === 'waiting' && t.requester.id === me.id) {
      t.status = 'in_progress';
      await this.tickets.save(t);
    }
    return this.get(id, me);
  }

  async retriage(id: number, me: AuthUser) {
    const t = await this.load(id, me);
    const r = await this.triageService.triage(t.title, t.description);
    Object.assign(t, {
      category: r.category,
      priority: r.priority,
      aiSummary: r.summary,
      aiSuggestedReply: r.suggestedReply || null,
      triageSource: r.source,
      slaDueAt: slaDueAt(r.priority, t.createdAt),
    });
    await this.tickets.save(t);
    return this.get(id, me);
  }

  async stats() {
    const all = await this.tickets.find();
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    const byCategory: Record<string, number> = {};
    let resolvedHours = 0;
    let resolvedCount = 0;
    let breached = 0;
    for (const t of all) {
      byStatus[t.status]++;
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
      if (t.resolvedAt) {
        resolvedCount++;
        resolvedHours += (t.resolvedAt.getTime() - t.createdAt.getTime()) / 3_600_000;
        if (t.resolvedAt > t.slaDueAt) breached++;
      }
    }
    return {
      total: all.length,
      byStatus,
      byCategory,
      overdue: all.filter((t) => isOverdue(t)).length,
      unassigned: await this.tickets.countBy({ assignee: IsNull(), status: In(['open', 'in_progress', 'waiting']) }),
      avgResolutionHours: resolvedCount ? Math.round((resolvedHours / resolvedCount) * 10) / 10 : null,
      slaMetRate: resolvedCount ? Math.round(((resolvedCount - breached) / resolvedCount) * 100) : null,
      aiTriage: this.triageService.enabled ? 'claude' : 'rules',
    };
  }

  agents() {
    return this.users.find({ where: { role: In(['agent', 'admin']) }, order: { name: 'ASC' } });
  }
}
