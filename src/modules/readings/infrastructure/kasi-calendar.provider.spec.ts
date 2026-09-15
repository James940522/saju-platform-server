import { ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { solarToLunar } from 'manseryeok';
import type { EnvironmentVariables } from '../../../config/environment.schema.js';
import { wealthCharts } from '../../../../test/fixtures/wealth-ranking.fixture.js';
import { KasiCalendarProvider } from './kasi-calendar.provider.js';

// Synthetic transport fixtures; conversion accuracy is covered by calculator
// fixtures. They are not represented as authenticated live KASI responses.
function monthXml(year = 1992, month = 10) {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const items = Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const lunar = solarToLunar(year, month, day);
    return `<item><solYear>${year}</solYear><solMonth>${String(month).padStart(2, '0')}</solMonth><solDay>${String(day).padStart(2, '0')}</solDay><lunYear>${lunar.year}</lunYear><lunMonth>${lunar.month}</lunMonth><lunDay>${lunar.day}</lunDay><lunLeapmonth>${lunar.isLeapMonth ? '윤' : '평'}</lunLeapmonth><lunIljin>사용하지 않는 필드</lunIljin></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items}</items><totalCount>${count}</totalCount></body></response>`;
}

describe('KASI optional official calendar adapter', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const provider = (enabled = true) =>
    new KasiCalendarProvider(
      new ConfigService<EnvironmentVariables, true>({
        KASI_CALENDAR_VERIFICATION_ENABLED: enabled,
        KASI_SERVICE_KEY: 'test+/=',
        KASI_TIMEOUT_MS: 2000,
      }),
    );
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockReset()
      .mockImplementation(async () => new Response(monthXml()));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not call the network when disabled', async () => {
    expect(await provider(false).verify(wealthCharts()[0]!.snapshot)).toBe(
      'disabled',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs a failed KASI request with correlation but without the key, dates, or XML', async () => {
    const debug = vi
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(
      new Response('private provider body', { status: 403 }),
    );
    expect(
      await provider().verify(wealthCharts()[0]!.snapshot, 'test-request-123'),
    ).toBe('unavailable');
    expect(warn).toHaveBeenCalledWith({
      event: 'kasi_request_failed',
      source: 'lunar_calendar',
      method: 'GET',
      endpoint:
        'https://apis.data.go.kr/B090041/openapi/service/LrsrCldInfoService/getLunCalInfo',
      callId: expect.any(String),
      requestId: 'test-request-123',
      stage: 'http_response',
      httpStatus: 403,
      durationMs: expect.any(Number),
    });
    const logged = JSON.stringify([debug.mock.calls, warn.mock.calls]);
    expect(logged).not.toMatch(/private|test\+\/=|1992|solYear|ServiceKey|\?/);
  });
  it('requests one month without birth day/time or identity and encodes the key exactly once', async () => {
    const snapshot = wealthCharts()[0]!.snapshot;
    expect(await provider().verify(snapshot)).toBe('matched');
    const [input, options] = fetchMock.mock.calls[0]!;
    expect(input).toBeInstanceOf(URL);
    if (!(input instanceof URL)) throw new Error('Expected a URL');
    expect(input.origin).toBe('https://apis.data.go.kr');
    expect(Object.fromEntries(input.searchParams)).toEqual({
      ServiceKey: 'test+/=',
      solYear: '1992',
      solMonth: '10',
      numOfRows: '31',
      pageNo: '1',
    });
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it('deduplicates in-flight requests and caches a validated month for 24 hours', async () => {
    const service = provider();
    const snapshot = wealthCharts()[0]!.snapshot;
    expect(
      await Promise.all([service.verify(snapshot), service.verify(snapshot)]),
    ).toEqual(['matched', 'matched']);
    await service.verify(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 24 * 60 * 60 * 1000 + 1);
    await service.verify(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('compares the civil calendar date even when solar time corrects to the previous day', async () => {
    const snapshot = wealthCharts()[0]!.snapshot;
    snapshot.normalizedBirth.timeCorrection!.correctedSolarDate = {
      year: 1992,
      month: 10,
      day: 23,
    };
    expect(await provider().verify(snapshot)).toBe('matched');
  });
  it('rejects conflicting lunar dates and leap-month flags instead of overwriting the snapshot', async () => {
    const snapshot = wealthCharts()[0]!.snapshot;
    snapshot.normalizedBirth.lunarDate.isLeapMonth =
      !snapshot.normalizedBirth.lunarDate.isLeapMonth;
    const before = structuredClone(snapshot);
    await expect(provider().verify(snapshot)).rejects.toThrow(
      ConflictException,
    );
    expect(snapshot).toEqual(before);
  });
  it('supports a known leap-month conversion', async () => {
    fetchMock.mockResolvedValueOnce(new Response(monthXml(2023, 3)));
    const snapshot = wealthCharts()[0]!.snapshot;
    snapshot.normalizedBirth.solarDate = { year: 2023, month: 3, day: 22 };
    snapshot.normalizedBirth.lunarDate = {
      year: 2023,
      month: 2,
      day: 1,
      isLeapMonth: true,
    };
    expect(await provider().verify(snapshot)).toBe('matched');
  });
  it.each([
    [
      'upstream HTTP failure',
      () => new Response('private upstream detail', { status: 503 }),
    ],
    [
      'authorization error XML',
      () =>
        new Response(
          '<OpenAPI_ServiceResponse><returnReasonCode>30</returnReasonCode></OpenAPI_ServiceResponse>',
        ),
    ],
    [
      'non-success result code',
      () =>
        new Response(monthXml().replace('<resultCode>00', '<resultCode>99')),
    ],
    ['wrong month', () => new Response(monthXml(1992, 11))],
    [
      'incomplete pagination',
      () => new Response(monthXml().replace(/<item>[\s\S]*?<\/item>/, '')),
    ],
    [
      'duplicate days',
      () => new Response(monthXml().replace('<solDay>02', '<solDay>01')),
    ],
    [
      'DTD/entity injection',
      () =>
        new Response(
          '<!DOCTYPE response [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
            monthXml(),
        ),
    ],
    ['oversized body', () => new Response(' '.repeat(65_537))],
    ['malformed XML', () => new Response('<response><body></response>')],
  ])(
    'marks %s unavailable without claiming verification',
    async (_name, response) => {
      fetchMock.mockResolvedValueOnce(response());
      expect(await provider().verify(wealthCharts()[0]!.snapshot)).toBe(
        'unavailable',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('does not cache failures or automatically retry timeouts', async () => {
    const service = provider();
    const snapshot = wealthCharts()[0]!.snapshot;
    fetchMock.mockRejectedValueOnce(
      new DOMException('private URL and key', 'TimeoutError'),
    );
    expect(await service.verify(snapshot)).toBe('unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await service.verify(snapshot)).toBe('matched');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
