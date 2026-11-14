import bcrypt from 'bcryptjs';
import type { DataSource } from 'typeorm';
import { slaDueAt, type Category, type Priority, type Status } from './domain.js';
import { Comment, Ticket, User } from './entities.js';

export const DEMO_PASSWORD = 'Demo@2026';

/** Demo accounts and a realistic week of tickets. Runs only on an empty database. */
export async function seed(ds: DataSource): Promise<void> {
  const users = ds.getRepository(User);
  if ((await users.count()) > 0) return;

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const [admin, agent, agent2, somchai, malee] = await users.save([
    { name: 'Admin IT', email: 'admin@demo.local', role: 'admin', department: 'IT', passwordHash: hash },
    { name: 'Thanaphat (IT)', email: 'agent@demo.local', role: 'agent', department: 'IT', passwordHash: hash },
    { name: 'Krit (IT)', email: 'agent2@demo.local', role: 'agent', department: 'IT', passwordHash: hash },
    { name: 'สมชาย ใจดี', email: 'user@demo.local', role: 'requester', department: 'บัญชี', passwordHash: hash },
    { name: 'มาลี ศรีสุข', email: 'malee@demo.local', role: 'requester', department: 'ฝ่ายขาย', passwordHash: hash },
  ] as User[]);
  void admin;

  const h = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000);
  type Row = [string, string, Category, Priority, Status, User, User | null, number, number | null, string];
  const rows: Row[] = [
    ['ปริ้นเตอร์ชั้น 3 กระดาษติดทุกแผ่น', 'เครื่อง HP ชั้น 3 หน้าห้องบัญชี กดพิมพ์แล้วกระดาษติดทุกครั้ง ทั้งแผนกพิมพ์ใบแจ้งหนี้ไม่ได้', 'printer', 'high', 'in_progress', somchai, agent, 3, null, 'เครื่องพิมพ์ชั้น 3 กระดาษติด ทั้งแผนกบัญชีพิมพ์เอกสารไม่ได้'],
    ['ลืมรหัสผ่านเข้าเครื่อง', 'เข้าเครื่องไม่ได้ตั้งแต่เช้า น่าจะใส่รหัสผิดหลายครั้งจนบัญชีถูกล็อก', 'account', 'high', 'open', malee, null, 1, null, 'บัญชีผู้ใช้ถูกล็อกเพราะใส่รหัสผิดหลายครั้ง เข้าเครื่องไม่ได้'],
    ['Wi-Fi ห้องประชุมใหญ่หลุดบ่อย', 'ประชุมออนไลน์กับลูกค้าแล้วเน็ตหลุดทุก 10 นาที ใช้ได้แต่ช้า', 'network', 'medium', 'waiting', malee, agent2, 26, null, 'Wi-Fi ห้องประชุมใหญ่หลุดเป็นช่วงๆ ระหว่างประชุมออนไลน์'],
    ['ขอลงโปรแกรม Power BI', 'ต้องใช้ทำรายงานยอดขายรายเดือน ขอลงในเครื่องโน้ตบุ๊กของฝ่ายขาย', 'software', 'low', 'open', malee, null, 30, null, 'ขอติดตั้ง Power BI สำหรับทำรายงานยอดขาย'],
    ['Excel ค้างเวลาเปิดไฟล์ใหญ่', 'ไฟล์งบประมาณ 40MB เปิดแล้วค้าง ต้องปิดโปรแกรมใหม่', 'software', 'medium', 'resolved', somchai, agent, 50, 30, 'Excel ค้างเมื่อเปิดไฟล์งบประมาณขนาดใหญ่'],
    ['เมาส์ไร้สายใช้ไม่ได้', 'เปลี่ยนถ่านแล้วก็ยังไม่ขยับ', 'hardware', 'low', 'closed', somchai, agent2, 80, 70, 'เมาส์ไร้สายไม่ทำงานแม้เปลี่ยนถ่านแล้ว'],
    ['Outlook ส่งเมลไม่ออก', 'เมลค้างอยู่ใน Outbox ตั้งแต่บ่าย มีเมลด่วนต้องส่งลูกค้า', 'software', 'high', 'resolved', malee, agent, 20, 14, 'อีเมลค้างใน Outbox ส่งออกไม่ได้'],
    ['จอที่สองไม่ขึ้นภาพ', 'ต่อจอเสริมแล้วขึ้น No signal', 'hardware', 'medium', 'in_progress', somchai, agent2, 10, null, 'จอที่สองไม่มีสัญญาณภาพ'],
  ];

  const tickets = ds.getRepository(Ticket);
  for (const [title, description, category, priority, status, requester, assignee, ago, resolvedAgo, summary] of rows) {
    const createdAt = h(ago);
    await tickets.save(
      tickets.create({
        title,
        description,
        category,
        priority,
        status,
        requester,
        assignee,
        aiSummary: summary,
        aiSuggestedReply: null,
        triageSource: 'rules',
        slaDueAt: slaDueAt(priority, createdAt),
        resolvedAt: resolvedAgo === null ? null : h(resolvedAgo),
        createdAt,
      }),
    );
  }

  const first = await tickets.findOneByOrFail({ title: rows[0][0] });
  await ds.getRepository(Comment).save([
    { ticket: first, author: agent, body: 'รับเรื่องแล้วครับ กำลังขึ้นไปดูที่ชั้น 3 ระหว่างนี้ใช้เครื่องชั้น 2 ไปก่อนได้ครับ', internal: false },
    { ticket: first, author: agent, body: 'ลูกยางดึงกระดาษสึก ต้องสั่งอะไหล่ ประมาณ 2 วัน', internal: true },
  ] as Comment[]);
}
