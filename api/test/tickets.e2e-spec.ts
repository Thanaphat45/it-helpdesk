import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configure } from '../src/main.js';
import { DEMO_PASSWORD, seed } from '../src/seed.js';

// No ANTHROPIC_API_KEY in tests: triage uses the keyword rules, so runs are free and deterministic.
delete process.env.ANTHROPIC_API_KEY;

describe('IT Helpdesk API (e2e)', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await configure(app);
    await app.init();
    await seed(app.get(DataSource));
    for (const who of ['user', 'malee', 'agent', 'agent2']) {
      const res = await http().post('/api/auth/login').send({ email: `${who}@demo.local`, password: DEMO_PASSWORD });
      tokens[who] = res.body.token;
    }
  });

  afterAll(() => app.close());

  describe('auth', () => {
    it('rejects a wrong password', () =>
      http().post('/api/auth/login').send({ email: 'user@demo.local', password: 'nope' }).expect(401));

    it('rejects a malformed body with 400', () => http().post('/api/auth/login').send({ email: 'x' }).expect(400));

    it('never returns the password hash', async () => {
      const res = await http().get('/api/auth/me').set(as('user')).expect(200);
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.role).toBe('requester');
    });

    it('requires a token', () => http().get('/api/tickets').expect(401));
  });

  describe('filing a ticket', () => {
    it('triages it, sets an SLA and opens it', async () => {
      const res = await http()
        .post('/api/tickets')
        .set(as('user'))
        .send({ title: 'เน็ตล่มทั้งแผนก', description: 'ทั้งแผนกบัญชีเข้าอินเทอร์เน็ตไม่ได้ตั้งแต่ 9 โมง' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'open', category: 'network', priority: 'urgent', triageSource: 'rules' });
      expect(res.body.code).toMatch(/^HD-\d{4}$/);
      const hours = (Date.parse(res.body.slaDueAt) - Date.parse(res.body.createdAt)) / 3_600_000;
      expect(Math.round(hours)).toBe(4);
    });

    it('validates the body', () => http().post('/api/tickets').set(as('user')).send({ title: 'x' }).expect(400));
  });

  describe('who sees what', () => {
    it('shows a requester only their own tickets', async () => {
      const res = await http().get('/api/tickets').set(as('malee')).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((t: any) => t.requester.email === 'malee@demo.local')).toBe(true);
    });

    it("returns 404 for someone else's ticket", async () => {
      const mine = await http().get('/api/tickets').set(as('user')).expect(200);
      await http().get(`/api/tickets/${mine.body[0].id}`).set(as('malee')).expect(404);
    });

    it('hides internal notes from the requester but shows them to staff', async () => {
      const list = await http().get('/api/tickets?q=ปริ้นเตอร์').set(as('agent')).expect(200);
      const id = list.body[0].id;
      const staff = await http().get(`/api/tickets/${id}`).set(as('agent')).expect(200);
      const requester = await http().get(`/api/tickets/${id}`).set(as('user')).expect(200);
      expect(staff.body.comments.some((c: any) => c.internal)).toBe(true);
      expect(requester.body.comments.some((c: any) => c.internal)).toBe(false);
    });

    it('keeps the dashboard and staff actions for IT only', async () => {
      await http().get('/api/stats').set(as('user')).expect(403);
      const res = await http().get('/api/stats').set(as('agent')).expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.aiTriage).toBe('rules');
    });
  });

  describe('status flow', () => {
    let id: number;
    beforeAll(async () => {
      const res = await http()
        .post('/api/tickets')
        .set(as('user'))
        .send({ title: 'Excel เปิดไม่ขึ้น', description: 'กดเปิด Excel แล้วไม่มีอะไรเกิดขึ้น' });
      id = res.body.id;
    });

    it('stops a requester from resolving their own ticket', () =>
      http().patch(`/api/tickets/${id}/status`).set(as('user')).send({ status: 'in_progress' }).expect(400));

    it('rejects a skipped step', () =>
      http().patch(`/api/tickets/${id}/status`).set(as('agent')).send({ status: 'resolved' }).expect(400));

    it('assigns the agent who starts work', async () => {
      const res = await http().patch(`/api/tickets/${id}/status`).set(as('agent')).send({ status: 'in_progress' }).expect(200);
      expect(res.body.assignee.email).toBe('agent@demo.local');
    });

    it('puts a waiting ticket back in progress when the requester replies', async () => {
      await http().patch(`/api/tickets/${id}/status`).set(as('agent')).send({ status: 'waiting' }).expect(200);
      const res = await http().post(`/api/tickets/${id}/comments`).set(as('user')).send({ body: 'ลองแล้วครับ ยังไม่ได้' }).expect(201);
      expect(res.body.status).toBe('in_progress');
    });

    it('lets the requester confirm the fix', async () => {
      const r = await http().patch(`/api/tickets/${id}/status`).set(as('agent')).send({ status: 'resolved' }).expect(200);
      expect(r.body.resolvedAt).toBeTruthy();
      const c = await http().patch(`/api/tickets/${id}/status`).set(as('user')).send({ status: 'closed' }).expect(200);
      expect(c.body.nextStatuses).toEqual([]);
    });

    it('refuses comments on a closed ticket', () =>
      http().post(`/api/tickets/${id}/comments`).set(as('user')).send({ body: 'อีกเรื่อง' }).expect(400));
  });

  describe('claiming a ticket', () => {
    it('lets exactly one of two agents take it when both click at once', async () => {
      const t = await http()
        .post('/api/tickets')
        .set(as('malee'))
        .send({ title: 'จอไม่ติด', description: 'เปิดคอมแล้วจอดำ ไฟจอติดสีส้ม' });
      const results = await Promise.all([
        http().post(`/api/tickets/${t.body.id}/claim`).set(as('agent')),
        http().post(`/api/tickets/${t.body.id}/claim`).set(as('agent2')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });

    it('is not allowed for requesters', async () => {
      const t = await http().post('/api/tickets').set(as('user')).send({ title: 'ขอเมาส์ใหม่', description: 'เมาส์ดับเบิลคลิกเอง' });
      await http().post(`/api/tickets/${t.body.id}/claim`).set(as('user')).expect(403);
    });
  });
});
