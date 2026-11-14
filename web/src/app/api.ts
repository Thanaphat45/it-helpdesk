import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export type Role = 'requester' | 'agent' | 'admin';
export type Status = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type Category = 'hardware' | 'software' | 'network' | 'account' | 'printer' | 'other';

export interface User { id: number; name: string; email: string; role: Role; department: string | null }
export interface Comment { id: number; body: string; internal: boolean; author: User; createdAt: string }
export interface Ticket {
  id: number; code: string; title: string; description: string;
  category: Category; priority: Priority; status: Status;
  requester: User; assignee: User | null;
  aiSummary: string | null; aiSuggestedReply: string | null; triageSource: 'claude' | 'rules' | null;
  slaDueAt: string; resolvedAt: string | null; createdAt: string; updatedAt: string;
  overdue: boolean; nextStatuses: Status[]; comments?: Comment[];
}
export interface Stats {
  total: number; byStatus: Record<Status, number>; byCategory: Record<string, number>;
  overdue: number; unassigned: number; avgResolutionHours: number | null; slaMetRate: number | null;
  aiTriage: 'claude' | 'rules';
}

export const STATUS_TH: Record<Status, string> = {
  open: 'รอรับเรื่อง', in_progress: 'กำลังดำเนินการ', waiting: 'รอข้อมูลจากผู้แจ้ง', resolved: 'แก้ไขแล้ว', closed: 'ปิดงาน',
};
export const PRIORITY_TH: Record<Priority, string> = { urgent: 'ด่วนมาก', high: 'สูง', medium: 'ปานกลาง', low: 'ต่ำ' };
export const CATEGORY_TH: Record<Category, string> = {
  hardware: 'ฮาร์ดแวร์', software: 'ซอฟต์แวร์', network: 'เครือข่าย', account: 'บัญชีผู้ใช้', printer: 'เครื่องพิมพ์', other: 'อื่นๆ',
};
/** Label for the button that performs a move, which reads better than the target status name. */
export const ACTION_TH: Record<Status, string> = {
  in_progress: 'เริ่มดำเนินการ', waiting: 'ขอข้อมูลเพิ่ม', resolved: 'แจ้งว่าแก้ไขแล้ว', closed: 'ปิดงาน', open: 'เปิดใหม่',
};

const KEY = 'helpdesk.session';

@Injectable({ providedIn: 'root' })
export class Session {
  private readonly state = signal<{ token: string; user: User } | null>(read());
  readonly user = computed(() => this.state()?.user ?? null);
  readonly token = computed(() => this.state()?.token ?? null);
  readonly isStaff = computed(() => this.user()?.role === 'agent' || this.user()?.role === 'admin');

  set(s: { token: string; user: User } | null) {
    this.state.set(s);
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {}
  }
}

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(Session).token();
  return next(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req);
};

/** Turns an API error into one line a person can act on. */
export function errorText(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ถ้าเพิ่งเปิดหน้าเว็บ รอสักครู่แล้วลองใหม่';
    const m = e.error?.message;
    return Array.isArray(m) ? m.join(', ') : m || `เกิดข้อผิดพลาด (${e.status})`;
  }
  return 'เกิดข้อผิดพลาด';
}

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  async login(email: string, password: string) {
    const s = await firstValueFrom(this.http.post<{ token: string; user: User }>('/api/auth/login', { email, password }));
    this.session.set(s);
  }
  logout() {
    this.session.set(null);
    this.router.navigateByUrl('/login');
  }

  tickets(q: { status?: string; assigned?: string; q?: string } = {}) {
    const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v));
    return firstValueFrom(this.http.get<Ticket[]>('/api/tickets', { params }));
  }
  ticket(id: number) { return firstValueFrom(this.http.get<Ticket>(`/api/tickets/${id}`)); }
  create(body: { title: string; description: string }) { return firstValueFrom(this.http.post<Ticket>('/api/tickets', body)); }
  setStatus(id: number, status: Status) { return firstValueFrom(this.http.patch<Ticket>(`/api/tickets/${id}/status`, { status })); }
  claim(id: number) { return firstValueFrom(this.http.post<Ticket>(`/api/tickets/${id}/claim`, {})); }
  update(id: number, body: Partial<{ priority: Priority; category: Category; assigneeId: number | null }>) {
    return firstValueFrom(this.http.patch<Ticket>(`/api/tickets/${id}`, body));
  }
  comment(id: number, body: string, internal: boolean) {
    return firstValueFrom(this.http.post<Ticket>(`/api/tickets/${id}/comments`, { body, internal }));
  }
  retriage(id: number) { return firstValueFrom(this.http.post<Ticket>(`/api/tickets/${id}/triage`, {})); }
  stats() { return firstValueFrom(this.http.get<Stats>('/api/stats')); }
  agents() { return firstValueFrom(this.http.get<User[]>('/api/agents')); }
}
