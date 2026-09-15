import {
  FORTUNETELLER_PACKAGE_VERSION,
  FORTUNETELLER_UPSTREAM_REVISION,
} from '@hoshin/saju-mcp-server';

// Installed source revisions, not URLs for the model to fetch at generation time.
export const SAJU_READING_SOURCES = {
  policyVersion: 'saju-reading-evidence-v4',
  calculation: {
    name: 'manseryeok',
    version: '2.0.0',
    repository: 'https://github.com/yhj1024/manseryeok',
  },
  calendarVerification: {
    name: 'kasi_lunisolar',
    dataset: 'https://www.data.go.kr/data/15012679/openapi.do',
    scope: ['solar_date', 'lunar_date', 'leap_month'],
  },
  interpretationReference: {
    repository: 'https://github.com/hjsh200219/fortuneteller',
    revision: FORTUNETELLER_UPSTREAM_REVISION,
    package: '@hoshin/saju-mcp-server',
    packageVersion: FORTUNETELLER_PACKAGE_VERSION,
    scope: [
      'hidden_stem_membership',
      'complete_branch_trines',
      'month_support',
      'seasonal_hidden_stem_ten_god_distribution',
      'day_master_strength_estimate',
      'strength_based_yongsin_candidates',
      'upstream_gyeokguk',
      'upstream_sinsal',
      'upstream_wealth_analysis',
    ],
    policyVersion: 'fortuneteller-native-v1',
    implementation: 'installed_upstream_fork',
  },
  solarTermVerification: {
    name: 'kasi_solar_terms',
    dataset: 'https://www.data.go.kr/data/15012690/openapi.do',
    scope: ['year_month_pillars', 'minute_precision_boundaries'],
    policyVersion: 'kasi-solar-boundary-v1',
  },
} as const;
