import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  ACTION_TH, Api, CATEGORY_TH, PRIORITY_TH, STATUS_TH, Session, errorText,
  type Category, type Priority, type Stats, type Status, type Ticket, type User,
} from './api';

const DEMO = [
  { email: 'user@demo.local', label: 'พนักงาน (ผู้แจ้งปัญหา)', hint: 'แจ้งปัญหาและติดตามเรื่องของตัวเอง' },
  { email: 'agent@demo.local', label: 'เจ้าหน้าที่ IT', hint: 'รับเรื่อง ดูผลจาก AI และตอบกลับ' },
  { email: 'admin@demo.local', label: 'ผู้ดูแลระบบ', hint: 'เห็นทุกอย่าง รวมถึงแดชบอร์ด' },
];

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <section class="login">
      <h1>IT Helpdesk</h1>
      <p class="muted">ระบบแจ้งซ่อมไอที พร้อม AI ช่วยคัดแยกเรื่อง</p>
      <h2>เข้าสู่ระบบด้วยบัญชีทดลอง</h2>
      <div class="demo">
        @for (d of demo; track d.email) {
          <button type="button" class="card pick" (click)="go(d.email, 'Demo@2026')" [disabled]="busy()">
            <b>{{ d.label }}</b><span class="muted">{{ d.hint }}</span>
          </button>
        }
      </div>
      <details>
        <summary>ใส่อีเมลและรหัสผ่านเอง</summary>
        <form (ngSubmit)="go(email, password)" class="stack">
          <label>อีเมล <input name="email" type="email" [(ngModel)]="email" required autocomplete="username"></label>
          <label>รหัสผ่าน <input name="password" type="password" [(ngModel)]="password" required autocomplete="current-password"></label>
          <button class="btn primary" [disabled]="busy()">เข้าสู่ระบบ</button>
        </form>
      </details>
      @if (busy()) { <p class="muted">กำลังเข้าสู่ระบบ… ถ้าเซิร์ฟเวอร์เพิ่งตื่น อาจใช้เวลาประมาณ 30 วินาที</p> }
      @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    </section>
  `,
})
export class LoginPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly demo = DEMO;
  email = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');

  async go(email: string, password: string) {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.login(email, password);
      this.router.navigateByUrl('/tickets');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-tickets',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <div class="row between">
      <h1>{{ session.isStaff() ? 'คิวงานแจ้งซ่อม' : 'เรื่องที่ฉันแจ้ง' }}</h1>
      <button class="btn primary" (click)="showForm.set(!showForm())">{{ showForm() ? 'ยกเลิก' : '+ แจ้งปัญหาใหม่' }}</button>
    </div>

    @if (showForm()) {
      <form class="card stack" (ngSubmit)="create()">
        <label>หัวข้อ <input name="title" [(ngModel)]="title" maxlength="160" required placeholder="เช่น ปริ้นเตอร์ชั้น 3 กระดาษติด"></label>
        <label>รายละเอียด
          <textarea name="description" [(ngModel)]="description" rows="4" required
            placeholder="เกิดอะไรขึ้น เริ่มเมื่อไหร่ กระทบใครบ้าง"></textarea>
        </label>
        <p class="muted small">ไม่ต้องเลือกหมวดหรือความเร่งด่วน ระบบจะจัดให้อัตโนมัติ และเจ้าหน้าที่ปรับได้ภายหลัง</p>
        <button class="btn primary" [disabled]="busy()">{{ busy() ? 'กำลังส่งและคัดแยกเรื่อง…' : 'ส่งเรื่อง' }}</button>
      </form>
    }

    <div class="filters">
      <select [(ngModel)]="status" (ngModelChange)="load()" aria-label="สถานะ">
        <option value="">ทุกสถานะ</option>
        @for (s of statuses; track s) { <option [value]="s">{{ STATUS[s] }}</option> }
      </select>
      @if (session.isStaff()) {
        <select [(ngModel)]="assigned" (ngModelChange)="load()" aria-label="ผู้รับผิดชอบ">
          <option value="">ทุกคน</option><option value="me">ของฉัน</option><option value="none">ยังไม่มีคนรับ</option>
        </select>
      }
      <input type="search" placeholder="ค้นหา" [(ngModel)]="q" (keyup.enter)="load()" aria-label="ค้นหา">
    </div>

    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }

    <ul class="list">
      @for (t of tickets(); track t.id) {
        <li>
          <a [routerLink]="['/tickets', t.id]" class="card ticket">
            <div class="row between">
              <span class="mono muted">{{ t.code }}</span>
              <span class="pill s-{{ t.status }}">{{ STATUS[t.status] }}</span>
            </div>
            <b>{{ t.title }}</b>
            @if (session.isStaff() && t.aiSummary) { <span class="muted small">{{ t.aiSummary }}</span> }
            <div class="row meta small">
              <span class="pill p-{{ t.priority }}">{{ PRIORITY[t.priority] }}</span>
              <span>{{ CATEGORY[t.category] }}</span>
              @if (session.isStaff()) { <span>{{ t.requester.name }}</span> }
              <span>{{ t.assignee ? 'ผู้รับผิดชอบ: ' + t.assignee.name : 'ยังไม่มีผู้รับเรื่อง' }}</span>
              @if (t.overdue) { <span class="late">เกิน SLA</span> }
              <span class="muted">{{ t.createdAt | date: 'd MMM HH:mm' }}</span>
            </div>
          </a>
        </li>
      } @empty {
        <li class="muted">{{ loading() ? 'กำลังโหลด…' : 'ไม่มีรายการ' }}</li>
      }
    </ul>
  `,
})
export class TicketsPage {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  readonly session = inject(Session);
  readonly STATUS = STATUS_TH;
  readonly PRIORITY = PRIORITY_TH;
  readonly CATEGORY = CATEGORY_TH;
  readonly statuses = Object.keys(STATUS_TH) as Status[];

  readonly tickets = signal<Ticket[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly showForm = signal(false);
  status = '';
  assigned = '';
  q = '';
  title = '';
  description = '';

  constructor() { this.load(); }

  async load() {
    this.loading.set(true);
    try {
      this.tickets.set(await this.api.tickets({ status: this.status, assigned: this.assigned, q: this.q }));
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.loading.set(false);
    }
  }

  async create() {
    this.busy.set(true);
    try {
      const t = await this.api.create({ title: this.title, description: this.description });
      this.router.navigate(['/tickets', t.id]);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-ticket',
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <a routerLink="/tickets" class="back">← กลับไปที่รายการ</a>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (t(); as t) {
      <div class="detail">
        <article class="stack">
          <div class="row between">
            <span class="mono muted">{{ t.code }}</span>
            <span class="pill s-{{ t.status }}">{{ STATUS[t.status] }}</span>
          </div>
          <h1>{{ t.title }}</h1>
          <p class="muted small">แจ้งโดย {{ t.requester.name }}{{ t.requester.department ? ' · ' + t.requester.department : '' }} · {{ t.createdAt | date: 'd MMM y HH:mm' }}</p>
          <p class="body">{{ t.description }}</p>

          <h2>การสนทนา</h2>
          <ul class="thread">
            @for (c of t.comments; track c.id) {
              <li [class.internal]="c.internal">
                <div class="small"><b>{{ c.author.name }}</b>&nbsp; <span class="muted">{{ c.createdAt | date: 'd MMM HH:mm' }}</span>
                  @if (c.internal) { <span class="pill">บันทึกภายใน</span> }</div>
                <p>{{ c.body }}</p>
              </li>
            } @empty { <li class="muted">ยังไม่มีข้อความ</li> }
          </ul>

          @if (t.status !== 'closed') {
            <form class="stack" (ngSubmit)="send()">
              <textarea name="reply" [(ngModel)]="reply" rows="4" placeholder="พิมพ์ข้อความ" aria-label="ข้อความ"></textarea>
              <div class="row">
                @if (session.isStaff()) {
                  <label class="check"><input type="checkbox" name="internal" [(ngModel)]="internal"> บันทึกภายใน (ผู้แจ้งไม่เห็น)</label>
                }
                <button class="btn primary" [disabled]="busy() || !reply.trim()">ส่งข้อความ</button>
              </div>
            </form>
          }
        </article>

        <aside class="stack">
          @if (t.nextStatuses.length || canClaim()) {
            <div class="card stack">
              <h3>ดำเนินการ</h3>
              @if (canClaim()) { <button class="btn primary" (click)="act(api.claim(t.id))" [disabled]="busy()">รับเรื่องนี้</button> }
              @for (s of t.nextStatuses; track s) {
                <button class="btn" (click)="act(api.setStatus(t.id, s))" [disabled]="busy()">{{ actionLabel(t, s) }}</button>
              }
            </div>
          }

          <div class="card stack small">
            <h3>รายละเอียด</h3>
            @if (session.isStaff()) {
              <label>ความเร่งด่วน
                <select [ngModel]="t.priority" (ngModelChange)="patch({ priority: $event })">
                  @for (p of priorities; track p) { <option [value]="p">{{ PRIORITY[p] }}</option> }
                </select>
              </label>
              <label>หมวด
                <select [ngModel]="t.category" (ngModelChange)="patch({ category: $event })">
                  @for (c of categories; track c) { <option [value]="c">{{ CATEGORY[c] }}</option> }
                </select>
              </label>
              <label>ผู้รับผิดชอบ
                <select [ngModel]="t.assignee?.id ?? ''" (ngModelChange)="patch({ assigneeId: $event ? +$event : null })">
                  <option value="">ยังไม่มี</option>
                  @for (a of agents(); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                </select>
              </label>
            } @else {
              <p>ความเร่งด่วน: <b>{{ PRIORITY[t.priority] }}</b></p>
              <p>หมวด: <b>{{ CATEGORY[t.category] }}</b></p>
              <p>ผู้รับผิดชอบ: <b>{{ t.assignee?.name ?? 'รอเจ้าหน้าที่รับเรื่อง' }}</b></p>
            }
            <p [class.late]="t.overdue">กำหนด SLA: <b>{{ t.slaDueAt | date: 'd MMM HH:mm' }}</b>{{ t.overdue ? ' (เกินกำหนด)' : '' }}</p>
          </div>

          @if (session.isStaff()) {
            <div class="card stack ai">
              <div class="row between">
                <h3>ผู้ช่วย AI</h3>
                <span class="pill">{{ t.triageSource === 'claude' ? 'Claude' : 'กฎคำสำคัญ' }}</span>
              </div>
              @if (t.aiSummary) { <p class="small"><b>สรุป:</b> {{ t.aiSummary }}</p> }
              @if (t.aiSuggestedReply) {
                <p class="small"><b>ร่างคำตอบ:</b></p>
                <p class="draft small">{{ t.aiSuggestedReply }}</p>
                <button class="btn" (click)="reply = t.aiSuggestedReply; internal = false">ใช้ร่างนี้ในช่องตอบกลับ</button>
              } @else if (t.triageSource === 'rules') {
                <p class="muted small">ตอนนี้ระบบคัดแยกด้วยกฎคำสำคัญ ถ้าตั้งค่า ANTHROPIC_API_KEY ไว้ Claude จะสรุปเรื่องและร่างคำตอบให้</p>
              }
              <button class="btn" (click)="act(api.retriage(t.id))" [disabled]="busy()">{{ busy() ? 'กำลังวิเคราะห์…' : 'ให้ AI วิเคราะห์ใหม่' }}</button>
            </div>
          }
        </aside>
      </div>
    }
  `,
})
export class TicketPage {
  readonly api = inject(Api);
  readonly session = inject(Session);
  readonly id = input.required<string>();
  readonly STATUS = STATUS_TH;
  readonly PRIORITY = PRIORITY_TH;
  readonly CATEGORY = CATEGORY_TH;
  readonly priorities = Object.keys(PRIORITY_TH) as Priority[];
  readonly categories = Object.keys(CATEGORY_TH) as Category[];

  readonly t = signal<Ticket | null>(null);
  readonly agents = signal<User[]>([]);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly canClaim = computed(() => this.session.isStaff() && !!this.t() && !this.t()!.assignee && this.t()!.status !== 'closed');
  reply = '';
  internal = false;

  constructor() {
    effect(() => { this.act(this.api.ticket(+this.id())); });
    if (this.session.isStaff()) this.api.agents().then((a) => this.agents.set(a)).catch(() => {});
  }

  actionLabel(t: Ticket, s: Status) {
    const mine = t.requester.id === this.session.user()?.id;
    if (mine && t.status === 'resolved') return s === 'closed' ? 'ยืนยันว่าแก้ไขแล้ว' : 'ยังแก้ไม่หาย';
    if (mine && t.status === 'open' && s === 'closed') return 'ยกเลิกเรื่องนี้';
    if (t.status === 'resolved' && s === 'in_progress') return 'เปิดงานอีกครั้ง';
    return ACTION_TH[s];
  }

  async act(p: Promise<Ticket>) {
    this.busy.set(true);
    try {
      this.t.set(await p);
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  patch(body: Parameters<Api['update']>[1]) { this.act(this.api.update(this.t()!.id, body)); }

  async send() {
    await this.act(this.api.comment(this.t()!.id, this.reply, this.internal));
    if (!this.error()) { this.reply = ''; this.internal = false; }
  }
}

@Component({
  selector: 'app-dashboard',
  template: `
    <h1>ภาพรวม</h1>
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (s(); as s) {
      <div class="tiles">
        <div class="card tile"><span class="muted small">เรื่องทั้งหมด</span><b>{{ s.total }}</b></div>
        <div class="card tile"><span class="muted small">ยังไม่มีคนรับ</span><b>{{ s.unassigned }}</b></div>
        <div class="card tile"><span class="muted small">เกิน SLA (ยังไม่ปิด)</span><b [class.late]="s.overdue > 0">{{ s.overdue }}</b></div>
        <div class="card tile"><span class="muted small">แก้ทันตาม SLA</span><b>{{ s.slaMetRate === null ? '–' : s.slaMetRate + '%' }}</b></div>
        <div class="card tile"><span class="muted small">เวลาแก้เฉลี่ย</span><b>{{ s.avgResolutionHours === null ? '–' : s.avgResolutionHours + ' ชม.' }}</b></div>
      </div>
      <div class="cols">
        <div class="card">
          <h3>ตามสถานะ</h3>
          @for (k of statusKeys; track k) { <div class="bar-row"><span>{{ STATUS[k] }}</span><i [style.width.%]="pct(s.byStatus[k], s.total)"></i><b>{{ s.byStatus[k] }}</b></div> }
        </div>
        <div class="card">
          <h3>ตามหมวด</h3>
          @for (k of categoryKeys; track k) { <div class="bar-row"><span>{{ CATEGORY[k] }}</span><i [style.width.%]="pct(s.byCategory[k] ?? 0, s.total)"></i><b>{{ s.byCategory[k] ?? 0 }}</b></div> }
        </div>
      </div>
      <p class="muted small">ระบบคัดแยกเรื่องตอนนี้ใช้: {{ s.aiTriage === 'claude' ? 'Claude (Anthropic API)' : 'กฎคำสำคัญ (ยังไม่ได้ตั้งค่า API key)' }}</p>
    }
  `,
})
export class DashboardPage {
  private readonly api = inject(Api);
  readonly STATUS = STATUS_TH;
  readonly CATEGORY = CATEGORY_TH;
  readonly statusKeys = Object.keys(STATUS_TH) as Status[];
  readonly categoryKeys = Object.keys(CATEGORY_TH) as Category[];
  readonly s = signal<Stats | null>(null);
  readonly error = signal('');
  constructor() { this.api.stats().then((s) => this.s.set(s)).catch((e) => this.error.set(errorText(e))); }
  pct(n: number, total: number) { return total ? Math.max(2, (n / total) * 100) : 0; }
}
