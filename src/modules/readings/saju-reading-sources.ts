// Reviewed source revisions, not URLs for the model to fetch at generation time.
export const SAJU_READING_SOURCES = {
  policyVersion: 'saju-reading-evidence-v1',
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
    revision: '1a930ad54c5342b855222e3aa304809b0ed587d5',
    scope: ['hidden_stem_membership', 'complete_branch_trines'],
    implementation: 'independent_rules_on_owned_snapshot',
  },
} as const;
