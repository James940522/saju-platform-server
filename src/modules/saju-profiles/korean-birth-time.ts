import { BadRequestException } from '@nestjs/common';
import type { BirthInput } from './saju-profile.contract.js';

export const KOREAN_TIME_DATA_VERSION =
  process.versions.tz ?? process.versions.icu ?? 'unknown';
const MINUTE_MS = 60_000;
const KST_OFFSET_MINUTES = 540;
export const MEAN_SOLAR_OFFSET_MINUTES = 510; // 127.5 degrees east × 4 minutes
const STANDARD_TIME_START = Date.UTC(1908, 3, 1);
const KOREAN_CIVIL_OFFSETS = [510, 540, 570, 600];
const koreaFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toDateTime(value: Date) {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
  };
}

function toKoreanCivilTime(instantMs: number) {
  const parts = koreaFormatter.formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

export function isBeforeKoreanStandardTime(date: BirthInput['date']) {
  return Date.UTC(date.year, date.month - 1, date.day) < STANDARD_TIME_START;
}

export function koreanCivilDateAt(instant: Date) {
  // Keep the pre-1908 fallback consistent with resolveKoreanBirthTime.
  return instant.getTime() + KST_OFFSET_MINUTES * MINUTE_MS <
    STANDARD_TIME_START
    ? toDateTime(new Date(instant.getTime() + KST_OFFSET_MINUTES * MINUTE_MS))
    : toKoreanCivilTime(instant.getTime());
}

export function resolveKoreanBirthTime(
  date: BirthInput['date'],
  hour: number,
  minute: number,
) {
  const wallMs = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let civilUtcOffsetMinutes = KST_OFFSET_MINUTES;

  if (!isBeforeKoreanStandardTime(date)) {
    // Resolve against IANA data without silently picking one side of a clock
    // rollback or accepting a local time skipped by daylight saving time.
    const matches = KOREAN_CIVIL_OFFSETS.filter((offset) => {
      const candidate = toKoreanCivilTime(wallMs - offset * MINUTE_MS);
      return (
        candidate.year === date.year &&
        candidate.month === date.month &&
        candidate.day === date.day &&
        candidate.hour === hour &&
        candidate.minute === minute
      );
    });
    const [matchedOffset] = matches;
    if (matches.length !== 1 || matchedOffset === undefined) {
      throw new BadRequestException({
        reason:
          matches.length === 0
            ? 'NONEXISTENT_BIRTH_TIME'
            : 'AMBIGUOUS_BIRTH_TIME',
        message:
          matches.length === 0
            ? '당시 표준시·서머타임 전환으로 존재하지 않는 시각입니다. 출생 기록을 확인해주세요.'
            : '당시 시계가 되돌아가 두 번 존재한 시각입니다. 현재는 이 시각을 확정해 계산할 수 없습니다.',
      });
    }
    civilUtcOffsetMinutes = matchedOffset;
  }

  const instantMs = wallMs - civilUtcOffsetMinutes * MINUTE_MS;
  return {
    civilUtcOffsetMinutes,
    adjustmentMinutes: MEAN_SOLAR_OFFSET_MINUTES - civilUtcOffsetMinutes,
    // Library expects KST. Normalize the civil instant first, then apply its
    // longitude-only correction. Do not shift the solar-term instant by 30m.
    libraryDateTime: toDateTime(
      new Date(instantMs + KST_OFFSET_MINUTES * MINUTE_MS),
    ),
    correctedDateTime: toDateTime(
      new Date(instantMs + MEAN_SOLAR_OFFSET_MINUTES * MINUTE_MS),
    ),
  };
}
