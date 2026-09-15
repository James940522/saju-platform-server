// Public service addresses. Credentials belong only in the server .env.
export const KASI_API_CONFIG = {
  lunarCalendar:
    'https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo',
  solarTerms:
    'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/get24DivisionsInfo',
} as const;
