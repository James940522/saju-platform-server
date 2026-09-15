import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isValidSolarDate } from 'manseryeok';
import { z } from 'zod';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import { KASI_API_CONFIG } from '../../../config/kasi-api.config.js';
import {
  getSajuSolarTermReference,
  type SajuChartSnapshotV1,
} from '../../saju-profiles/index.js';
import {
  SOLAR_TERM_NAMES,
  solarTermVerification,
  verifySolarTermPillars,
  type SolarTerm,
  type SolarTermVerification,
} from '../saju-solar-term-verification.js';
import { fetchKasiXml } from './kasi-xml.js';

const YearResponseSchema = z.object({
  response: z.object({
    header: z.object({ resultCode: z.literal('00') }),
    body: z.object({
      totalCount: z.string().regex(/^\d+$/).transform(Number),
      items: z.unknown().optional(),
    }),
  }),
});
const ItemsSchema = z.object({
  item: z
    .array(
      z.object({
        dateKind: z.literal('03'),
        dateName: z.enum(SOLAR_TERM_NAMES),
        locdate: z.string().regex(/^\d{8}$/),
        kst: z
          .string()
          .trim()
          .regex(/^\d{1,4}$/)
          .transform((value) => value.padStart(4, '0')),
        sunLongitude: z
          .string()
          .regex(/^\d+(\.0+)?$/)
          .transform(Number),
      }),
    )
    .length(24),
});
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED_YEARS = 256;
class SolarTermDataUnavailable extends Error {}

function parseYear(raw: unknown, year: number): SolarTerm[] {
  const { body } = YearResponseSchema.parse(raw).response;
  if (body.totalCount === 0) throw new SolarTermDataUnavailable();
  if (body.totalCount !== 24) throw new Error('Incomplete solar terms');
  const { item: items } = ItemsSchema.parse(body.items);
  if (new Set(items.map(({ dateName }) => dateName)).size !== 24)
    throw new Error('Duplicate solar terms');
  // Only the 12 Jie determine year/month pillars. The official 2019 response
  // contains kst=1760 for Daehan (a Zhongqi); do not invent a corrected time or
  // let an unused Zhongqi clock invalidate the independently valid 12 Jie.
  const terms = items
    .filter((item) => SOLAR_TERM_NAMES.indexOf(item.dateName) % 2 === 0)
    .map((item) => {
      const index = SOLAR_TERM_NAMES.indexOf(item.dateName);
      const dateYear = Number(item.locdate.slice(0, 4));
      const month = Number(item.locdate.slice(4, 6));
      const day = Number(item.locdate.slice(6, 8));
      const hour = Number(item.kst.slice(0, 2));
      const minute = Number(item.kst.slice(2));
      if (
        dateYear !== year ||
        !isValidSolarDate(year, month, day) ||
        month !== Math.floor(index / 2) + 1 ||
        hour > 23 ||
        minute > 59 ||
        item.sunLongitude !== (285 + index * 15) % 360
      )
        throw new Error('Invalid solar term');
      return {
        index,
        instantMs: Date.UTC(year, month - 1, day, hour - 9, minute),
      };
    })
    .sort((a, b) => a.index - b.index);
  if (
    terms.some(
      (term, index) =>
        index > 0 && term.instantMs <= terms[index - 1]!.instantMs,
    )
  )
    throw new Error('Unordered solar terms');
  return terms;
}

@Injectable()
export class KasiSolarTermsProvider {
  private readonly cache = new Map<
    number,
    { expiresAt: number; terms: SolarTerm[] }
  >();
  private readonly pending = new Map<number, Promise<SolarTerm[]>>();

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async verify(
    snapshot: SajuChartSnapshotV1,
    requestId?: string,
  ): Promise<SolarTermVerification> {
    if (
      !this.config.get('KASI_SOLAR_TERMS_VERIFICATION_ENABLED', { infer: true })
    )
      return solarTermVerification('disabled');
    const reference = getSajuSolarTermReference(snapshot);
    if (!reference) return solarTermVerification('unsupported_policy');
    const key = this.config.get('KASI_SPECIAL_SERVICE_KEY', { infer: true });
    if (!key) return solarTermVerification('unavailable');
    let terms: SolarTerm[];
    try {
      // January needs the previous December's month boundary. Other months
      // need only one public year; no birth day/time or identity is transmitted.
      const years =
        snapshot.normalizedBirth.solarDate.month === 1
          ? [reference.year - 1, reference.year]
          : [reference.year];
      terms = (
        await Promise.all(
          years.map((year) => this.getYear(year, key, requestId)),
        )
      ).flat();
    } catch (error: unknown) {
      return solarTermVerification(
        error instanceof SolarTermDataUnavailable ? 'no_data' : 'unavailable',
      );
    }
    // Domain conflicts must propagate: never disguise a mismatch as an outage.
    return verifySolarTermPillars(snapshot, terms);
  }

  private async getYear(
    year: number,
    key: string,
    requestId?: string,
  ): Promise<SolarTerm[]> {
    const cached = this.cache.get(year);
    if (cached && cached.expiresAt > Date.now()) return cached.terms;
    this.cache.delete(year);
    const pending = this.pending.get(year);
    if (pending) return pending;
    const operation = this.fetchYear(year, key, requestId);
    this.pending.set(year, operation);
    try {
      const terms = await operation;
      if (this.cache.size >= MAX_CACHED_YEARS) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(year, { terms, expiresAt: Date.now() + CACHE_TTL_MS });
      return terms;
    } finally {
      this.pending.delete(year);
    }
  }

  private async fetchYear(year: number, key: string, requestId?: string) {
    const url = new URL(KASI_API_CONFIG.solarTerms);
    url.search = new URLSearchParams({
      ServiceKey: key,
      solYear: String(year),
      numOfRows: '100',
      pageNo: '1',
    }).toString();
    return parseYear(
      await fetchKasiXml(
        url,
        this.config.get('KASI_TIMEOUT_MS', { infer: true }),
        requestId,
      ),
      year,
    );
  }
}
