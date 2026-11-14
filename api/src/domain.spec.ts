import { canTransition, isOverdue, nextStatuses, slaDueAt } from './domain.js';
import { ruleTriage } from './triage.service.js';

describe('ticket status flow', () => {
  it('lets staff make any move the flow allows', () => {
    expect(canTransition('open', 'in_progress', 'agent', false)).toBe(true);
    expect(canTransition('in_progress', 'resolved', 'admin', false)).toBe(true);
  });

  it('rejects moves outside the flow, even for staff', () => {
    expect(canTransition('open', 'resolved', 'agent', false)).toBe(false);
    expect(canTransition('closed', 'open', 'admin', false)).toBe(false);
  });

  it('lets a requester only cancel an open ticket or answer a resolved one', () => {
    expect(nextStatuses('open', 'requester', true)).toEqual(['closed']);
    expect(nextStatuses('in_progress', 'requester', true)).toEqual([]);
    expect(nextStatuses('resolved', 'requester', true)).toEqual(['closed', 'in_progress']);
  });

  it('gives a requester no moves on a ticket that is not theirs', () => {
    expect(nextStatuses('resolved', 'requester', false)).toEqual([]);
  });
});

describe('SLA', () => {
  const t0 = new Date('2026-11-14T09:00:00Z');

  it('sets the due time by priority', () => {
    expect(slaDueAt('urgent', t0).toISOString()).toBe('2026-11-14T13:00:00.000Z');
    expect(slaDueAt('low', t0).toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });

  it('counts only unfinished tickets as overdue', () => {
    const due = new Date('2026-11-14T10:00:00Z');
    const later = new Date('2026-11-14T11:00:00Z');
    expect(isOverdue({ status: 'in_progress', slaDueAt: due }, later)).toBe(true);
    expect(isOverdue({ status: 'resolved', slaDueAt: due }, later)).toBe(false);
  });
});

describe('rule-based triage fallback', () => {
  it('reads Thai keywords', () => {
    expect(ruleTriage('ปริ้นไม่ออก', 'เครื่องพิมพ์ชั้น 2').category).toBe('printer');
    expect(ruleTriage('ลืมรหัสผ่าน', 'เข้าระบบไม่ได้').category).toBe('account');
  });

  it('raises priority when many people are affected', () => {
    expect(ruleTriage('เน็ตล่ม', 'ทั้งแผนกใช้อินเทอร์เน็ตไม่ได้').priority).toBe('urgent');
    expect(ruleTriage('ขอลงโปรแกรม', 'ขอติดตั้ง Power BI').priority).toBe('medium');
  });
});
