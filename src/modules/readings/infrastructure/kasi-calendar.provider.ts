import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isValidSolarDate } from 'manseryeok';
import { z } from 'zod';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import type { SajuChartSnapshotV1 } from '../../saju-profiles/index.js';

const KASI_URL =
  'https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo';
const MAX_RESPONSE_BYTES = 65_536;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_MONTHS = 256;
const integerText = (min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));
const CalendarItemSchema = z.object({
  solYear: integerText(1391, 2100),
  solMonth: integerText(1, 12),
  solDay: integerText(1, 31),
  lunYear: integerText(1390, 2100),
  lunMonth: integerText(1, 12),
  lunDay: integerText(1, 30),
  lunLeapmonth: z.enum(['평', '윤']),
});
const CalendarResponseSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.literal('00') }),
    body: z.object({
      items: z.object({ item: z.array(CalendarItemSchema).min(1).max(31) }),
      totalCount: integerText(1, 31),
    }),
  }),
});
type CalendarItem = z.output<typeof CalendarItemSchema>;
export type CalendarVerificationStatus = 'matched' | 'disabled' | 'unavailable';

function parseMonth(xml: string, year: number, month: number): CalendarItem[] {
  // No DTDs, custom entities, recovery parsing, or provider text in model prompts.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid calendar XML');
  const raw: unknown = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    processEntities: false,
    isArray: (_name, path) => path === 'response.body.items.item',
  }).parse(xml);
  const { body } = CalendarResponseSchema.parse(raw).response;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (
    body.totalCount !== daysInMonth ||
    body.items.item.length !== daysInMonth ||
    new Set(body.items.item.map((item) => item.solDay)).size !== daysInMonth ||
    body.items.item.some(
      (item) =>
        item.solYear !== year ||
        item.solMonth !== month ||
        !isValidSolarDate(item.solYear, item.solMonth, item.solDay),
    )
  ) {
    throw new Error('Incomplete calendar month');
  }
  return body.items.item;
}

@Injectable()
export class KasiCalendarProvider {
  private readonly cache = new Map<
    string,
    { expiresAt: number; items: CalendarItem[] }
  >();
  private readonly pending = new Map<string, Promise<CalendarItem[]>>();

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async verify(
    snapshot: SajuChartSnapshotV1,
  ): Promise<CalendarVerificationStatus> {
    if (!this.config.get('KASI_CALENDAR_VERIFICATION_ENABLED', { infer: true }))
      return 'disabled';
    const key = this.config.get('KASI_SERVICE_KEY', { infer: true });
    if (!key) return 'unavailable';
    const { solarDate, lunarDate } = snapshot.normalizedBirth;
    let items: CalendarItem[];
    try {
      items = await this.getMonth(solarDate.year, solarDate.month, key);
    } catch {
      // Optional reference failure must not masquerade as a successful verification.
      // Do not log the URL, key, birth month, raw XML or upstream exception.
      return 'unavailable';
    }
    const item = items.find((candidate) => candidate.solDay === solarDate.day);
    if (
      !item ||
      item.lunYear !== lunarDate.year ||
      item.lunMonth !== lunarDate.month ||
      item.lunDay !== lunarDate.day ||
      (item.lunLeapmonth === '윤') !== lunarDate.isLeapMonth
    ) {
      throw new ConflictException({
        message:
          '저장된 사주의 음양력 정보가 공식 달력 자료와 일치하지 않아 풀이를 중단했습니다. 생년월일과 윤달 여부를 확인해주세요.',
        reason: 'SAJU_CALENDAR_MISMATCH',
      });
    }
    return 'matched';
  }

  private async getMonth(
    year: number,
    month: number,
    key: string,
  ): Promise<CalendarItem[]> {
    const cacheKey = `${year}-${month}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.items;
    this.cache.delete(cacheKey);
    const pending = this.pending.get(cacheKey);
    if (pending) return pending;
    const operation = this.fetchMonth(year, month, key);
    this.pending.set(cacheKey, operation);
    try {
      const items = await operation;
      if (this.cache.size >= MAX_CACHED_MONTHS) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, items });
      return items;
    } finally {
      this.pending.delete(cacheKey);
    }
  }

  private async fetchMonth(
    year: number,
    month: number,
    key: string,
  ): Promise<CalendarItem[]> {
    const url = new URL(KASI_URL);
    // Retrieve a whole public calendar month: no name, day, time, account or chart ID.
    url.search = new URLSearchParams({
      ServiceKey: key,
      solYear: String(year),
      solMonth: String(month).padStart(2, '0'),
      numOfRows: '31',
      pageNo: '1',
    }).toString();
    const response = await fetch(url, {
      signal: AbortSignal.timeout(
        this.config.get('KASI_TIMEOUT_MS', { infer: true }),
      ),
      redirect: 'error',
      headers: { Accept: 'application/xml' },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Calendar provider unavailable');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES)
          throw new Error('Calendar response too large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    return parseMonth(Buffer.concat(chunks).toString('utf8'), year, month);
  }
}
