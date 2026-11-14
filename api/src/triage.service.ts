import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { CATEGORIES, PRIORITIES, type Category, type Priority } from './domain.js';

export interface Triage {
  category: Category;
  priority: Priority;
  summary: string;
  suggestedReply: string;
  source: 'claude' | 'rules';
}

const TriageSchema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
  summary: z.string(),
  suggested_reply: z.string(),
});

// Kept byte-for-byte stable so the prefix can be cached across requests.
const SYSTEM = `You triage IT helpdesk tickets for a mid-sized Thai company.
Users write in Thai or English, often briefly and without technical terms.

Return:
- category: hardware, software, network, account (logins, passwords, permissions), printer, or other.
- priority, judged by business impact rather than by how upset the user sounds:
  urgent = many people or a core system is down, or a security incident;
  high = one person cannot work at all;
  medium = work is slowed or there is a workaround;
  low = a request, a question, or something cosmetic.
- summary: one plain sentence for the IT queue, in the same language as the ticket.
- suggested_reply: a short, friendly first reply the IT agent can edit before sending,
  in the same language as the ticket. Give one or two safe first steps the user can try,
  or ask for the one piece of information needed. Never ask for passwords.`;

/** Keyword fallback used when no API key is set or the Claude call fails. */
const RULES: { category: Category; words: RegExp }[] = [
  { category: 'printer', words: /print|ปริ้น|พิมพ์|หมึก|toner|scan|สแกน/i },
  { category: 'network', words: /wifi|wi-fi|internet|เน็ต|network|vpn|lan|เชื่อมต่อ|สัญญาณ/i },
  { category: 'account', words: /password|รหัสผ่าน|login|ล็อกอิน|เข้าระบบ|account|บัญชี|สิทธิ์|permission|locked/i },
  { category: 'hardware', words: /เครื่อง|คอม|จอ|monitor|keyboard|mouse|เมาส์|คีย์บอร์ด|notebook|laptop|เปิดไม่ติด|battery/i },
  { category: 'software', words: /excel|word|outlook|office|โปรแกรม|program|install|ติดตั้ง|update|error|แอป|app/i },
];
const URGENT = /ทั้งแผนก|ทั้งทีม|ทั้งบริษัท|ทุกคน|everyone|whole team|server down|ระบบล่ม|ไวรัส|virus|ransomware|hack/i;
const HIGH = /ทำงานไม่ได้|ใช้ไม่ได้เลย|เปิดไม่ติด|can't work|cannot work|ด่วน|urgent/i;

export function ruleTriage(title: string, description: string): Triage {
  const text = `${title}\n${description}`;
  const category = RULES.find((r) => r.words.test(text))?.category ?? 'other';
  const priority: Priority = URGENT.test(text) ? 'urgent' : HIGH.test(text) ? 'high' : 'medium';
  return {
    category,
    priority,
    summary: title.slice(0, 300),
    suggestedReply: '',
    source: 'rules',
  };
}

@Injectable()
export class TriageService {
  private readonly log = new Logger(TriageService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ timeout: 30_000, maxRetries: 1 }) : null;
  private readonly dailyLimit = Number(process.env.AI_DAILY_LIMIT ?? 100);
  private used = 0;
  private day = new Date().toDateString();

  get enabled(): boolean {
    return this.client !== null;
  }

  async triage(title: string, description: string): Promise<Triage> {
    if (!this.client || !this.takeQuota()) return ruleTriage(title, description);
    try {
      const response = await this.client.beta.messages.parse({
        model: 'claude-opus-5-5',
        max_tokens: 2000,
        // Classification: low effort is enough and keeps ticket creation fast.
        output_config: { effort: 'low', format: zodOutputFormat(TriageSchema) },
        // If a safety classifier declines, the API retries on a fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `<title>${title}</title>\n<description>${description}</description>` }],
      });
      const out = response.parsed_output;
      if (response.stop_reason === 'refusal' || !out) return ruleTriage(title, description);
      return {
        category: out.category,
        priority: out.priority,
        summary: out.summary.slice(0, 300),
        suggestedReply: out.suggested_reply,
        source: 'claude',
      };
    } catch (err) {
      // A triage failure must never block someone from filing a ticket.
      if (err instanceof Anthropic.RateLimitError) this.log.warn('Claude rate limited; using rules');
      else if (err instanceof Anthropic.APIError) this.log.warn(`Claude API error ${err.status}; using rules`);
      else this.log.warn(`Claude call failed (${(err as Error).message}); using rules`);
      return ruleTriage(title, description);
    }
  }

  /** Simple per-process daily cap so a public demo cannot run up the bill. */
  private takeQuota(): boolean {
    const today = new Date().toDateString();
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.dailyLimit) return false;
    this.used++;
    return true;
  }
}
