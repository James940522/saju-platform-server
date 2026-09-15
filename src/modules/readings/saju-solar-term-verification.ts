import { ConflictException } from '@nestjs/common';
import { EARTHLY_BRANCHES, HEAVENLY_STEMS } from 'manseryeok';
import {
  getSajuSolarTermReference,
  type SajuChartSnapshotV1,
} from '../saju-profiles/index.js';

export const SOLAR_TERM_NAMES = [
  '소한',
  '대한',
  '입춘',
  '우수',
  '경칩',
  '춘분',
  '청명',
  '곡우',
  '입하',
  '소만',
  '망종',
  '하지',
  '소서',
  '대서',
  '입추',
  '처서',
  '백로',
  '추분',
  '한로',
  '상강',
  '입동',
  '소설',
  '대설',
  '동지',
] as const;
export type SolarTerm = { index: number; instantMs: number };
export type SolarTermVerificationStatus =
  'matched' | 'disabled' | 'unavailable' | 'no_data' | 'unsupported_policy';

export function solarTermVerification(status: SolarTermVerificationStatus) {
  return {
    status,
    scope: 'year_month_pillars' as const,
    precision: 'minute' as const,
    policyVersion: 'kasi-solar-boundary-v1',
  };
}
export type SolarTermVerification = ReturnType<typeof solarTermVerification>;

const mod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

export function verifySolarTermPillars(
  snapshot: SajuChartSnapshotV1,
  terms: readonly SolarTerm[],
): SolarTermVerification {
  const reference = getSajuSolarTermReference(snapshot);
  if (!reference) return solarTermVerification('unsupported_policy');
  const { year, startMs, endMs } = reference;
  const yearStart = terms.find((term) => {
    const kstYear = new Date(term.instantMs + 9 * 3_600_000).getUTCFullYear();
    return term.index === 2 && kstYear === year;
  });
  const boundaries = terms.filter(({ index }) => index % 2 === 0);
  // KASI kst and user input have minute precision. Within one minute on either
  // side (including an unknown-time day crossing it), do not choose a pillar.
  if (
    boundaries.some(
      ({ instantMs }) =>
        startMs <= instantMs + 60_000 && endMs >= instantMs - 60_000,
    )
  ) {
    throw new ConflictException({
      reason: 'SAJU_SOLAR_TERM_BOUNDARY_UNCERTAIN',
      message:
        '출생 시각이 절기 경계에 걸려 연주·월주를 확정할 수 없습니다. 출생 시각을 확인해주세요.',
    });
  }
  const monthStart = boundaries
    .filter(({ instantMs }) => instantMs <= startMs)
    .sort((a, b) => b.instantMs - a.instantMs)[0];
  if (!yearStart || !monthStart) return solarTermVerification('no_data');
  const sajuYear = startMs < yearStart.instantMs ? year - 1 : year;
  const monthNumber = monthStart.index === 0 ? 12 : monthStart.index / 2;
  const yearStem = mod(sajuYear - 4, 10);
  const expectedYear =
    HEAVENLY_STEMS[yearStem]! + EARTHLY_BRANCHES[mod(sajuYear - 4, 12)]!;
  const expectedMonth =
    HEAVENLY_STEMS[((yearStem % 5) * 2 + monthNumber + 1) % 10]! +
    EARTHLY_BRANCHES[(monthNumber + 1) % 12]!;
  if (
    snapshot.pillars.year.korean !== expectedYear ||
    snapshot.pillars.month.korean !== expectedMonth
  ) {
    throw new ConflictException({
      reason: 'SAJU_SOLAR_TERM_MISMATCH',
      message:
        '저장된 사주의 연주·월주가 공식 절기 자료와 일치하지 않아 풀이를 중단했습니다. 사주 정보를 다시 저장해주세요.',
    });
  }
  return solarTermVerification('matched');
}
