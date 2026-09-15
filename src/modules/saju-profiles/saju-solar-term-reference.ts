import type { SajuChartSnapshotV1 } from './saju-profile.contract.js';
import {
  SAJU_ENGINE_NAME,
  SAJU_ENGINE_VERSION,
  SAJU_POLICY_VERSION,
} from './saju-chart-calculator.js';
import {
  KOREAN_TIME_DATA_VERSION,
  resolveKoreanBirthTime,
} from './korean-birth-time.js';

// Public server-only reference for independent calendar verification. Preserve
// the snapshot's recorded civil offset; never apply its solar correction twice.
export function getSajuSolarTermReference(snapshot: SajuChartSnapshotV1) {
  if (
    snapshot.calculation.engine !== SAJU_ENGINE_NAME ||
    snapshot.calculation.engineVersion !== SAJU_ENGINE_VERSION ||
    snapshot.calculation.policyVersion !== SAJU_POLICY_VERSION
  )
    return null;
  const { solarDate, time, timeCorrection } = snapshot.normalizedBirth;
  const wall = Date.UTC(solarDate.year, solarDate.month - 1, solarDate.day);
  if (time.precision === 'exact') {
    const offset = timeCorrection?.civilUtcOffsetMinutes;
    if (offset == null || ![510, 540, 570, 600].includes(offset)) return null;
    const startMs = wall + (time.hour * 60 + time.minute - offset) * 60_000;
    return { year: solarDate.year, startMs, endMs: startMs + 59_999 };
  }
  // Unknown time is the entire civil day, not the calculator's noon placeholder.
  if (snapshot.calculation.timeZoneDatabaseVersion !== KOREAN_TIME_DATA_VERSION)
    return null;
  try {
    const start = resolveKoreanBirthTime(solarDate, 0, 0);
    const end = resolveKoreanBirthTime(solarDate, 23, 59);
    return {
      year: solarDate.year,
      startMs: wall - start.civilUtcOffsetMinutes * 60_000,
      endMs: wall + 86_400_000 - end.civilUtcOffsetMinutes * 60_000 - 1,
    };
  } catch {
    return null;
  }
}
