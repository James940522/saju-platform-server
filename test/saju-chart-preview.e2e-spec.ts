import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import { ApiErrorResponseSchema } from '../src/common/contracts/api-response.schema.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PreviewSajuChartResponseSchema,
  type PreviewSajuChartRequest,
} from '../src/modules/saju-profiles/saju-chart-preview.contract.js';

const birth: PreviewSajuChartRequest['birth'] = {
  calendarType: 'solar',
  isLeapMonth: false,
  date: { year: 1992, month: 10, day: 24 },
  time: { precision: 'exact', hour: 5, minute: 30 },
  luckCycleGender: 'male',
};
const path = '/v1/saju-charts/preview';

describe('Saju chart preview calculation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No database methods are available: any persistence access fails the test.
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = moduleFixture.createNestApplication();
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    { title: 'exact time', birth, quality: 'complete', solarDate: birth.date },
    {
      title: 'unknown time',
      birth: { ...birth, time: { precision: 'unknown' } },
      quality: 'partial',
      solarDate: birth.date,
    },
    {
      title: 'lunar leap month',
      birth: {
        ...birth,
        calendarType: 'lunar',
        isLeapMonth: true,
        date: { year: 2023, month: 2, day: 1 },
      },
      quality: 'complete',
      solarDate: { year: 2023, month: 3, day: 22 },
    },
  ])(
    'calculates $title without authentication or storage',
    async ({ birth, quality, solarDate }) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .send({ birth })
        .expect(200);
      const body = PreviewSajuChartResponseSchema.parse(response.body);

      expect(body.data).toMatchObject({
        status: 'calculated',
        snapshot: {
          schemaVersion: 1,
          quality,
          normalizedBirth: { solarDate, time: birth.time },
          calculation: {
            engineVersion: '2.0.0',
            policyVersion: 'kr-mean-solar-midnight-v2',
          },
          elementDistribution: { totalSymbols: quality === 'partial' ? 6 : 8 },
        },
      });
      expect(Object.keys(body.data).sort()).toEqual(['snapshot', 'status']);
      if (quality === 'partial') {
        expect(body.data.snapshot.pillars.hour).toBeNull();
        expect(body.data.snapshot.luckCycle).toBeNull();
        expect(body.data.snapshot.warnings.map(({ code }) => code)).toEqual([
          'birth_time_unknown',
          'luck_cycle_unavailable',
          'day_boundary_uncertain',
        ]);
      } else {
        expect(body.data.snapshot.pillars.hour).not.toBeNull();
        expect(body.data.snapshot.luckCycle).not.toBeNull();
      }
      if (birth.calendarType === 'solar') {
        expect(body.data.snapshot.pillars).toMatchObject({
          year: { korean: '임신' },
          month: { korean: '경술' },
          day: { korean: '계유' },
        });
      }
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toEqual(expect.any(String));
    },
  );

  it.each([
    {
      reason: 'INVALID_SOLAR_DATE',
      input: { ...birth, date: { year: 2023, month: 2, day: 29 } },
    },
    {
      reason: 'NONEXISTENT_BIRTH_TIME',
      input: {
        ...birth,
        date: { year: 1988, month: 5, day: 8 },
        time: { precision: 'exact', hour: 2, minute: 30 },
      },
    },
    {
      reason: 'AMBIGUOUS_BIRTH_TIME',
      input: {
        ...birth,
        date: { year: 1988, month: 10, day: 9 },
        time: { precision: 'exact', hour: 2, minute: 30 },
      },
    },
    {
      reason: 'INVALID_LEAP_MONTH',
      input: { ...birth, calendarType: 'lunar', isLeapMonth: true },
    },
    {
      reason: 'FUTURE_BIRTH_DATE',
      input: { ...birth, date: { year: 2099, month: 1, day: 1 } },
    },
    {
      reason: 'UNSUPPORTED_BIRTH_YEAR',
      input: { ...birth, date: { year: 2300, month: 1, day: 1 } },
    },
    {
      reason: 'BIRTH_TIME_REQUIRED_ON_BOUNDARY_DATE',
      input: {
        ...birth,
        date: { year: 2024, month: 2, day: 4 },
        time: { precision: 'unknown' },
      },
    },
  ])(
    'returns $reason instead of an invented chart',
    async ({ input, reason }) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .send({ birth: input })
        .expect(400);
      const body = ApiErrorResponseSchema.parse(response.body);
      expect(body.data?.reason).toBe(reason);
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it.each([
    { title: 'missing birth input', input: {} },
    {
      title: 'missing gender',
      input: { birth: { ...birth, luckCycleGender: undefined } },
    },
    {
      title: 'incomplete exact time',
      input: { birth: { ...birth, time: { precision: 'exact', hour: 5 } } },
    },
    {
      title: 'unknown time with fabricated hour',
      input: { birth: { ...birth, time: { precision: 'unknown', hour: 12 } } },
    },
    {
      title: 'out of range month',
      input: { birth: { ...birth, date: { ...birth.date, month: 13 } } },
    },
    {
      title: 'solar leap month',
      input: { birth: { ...birth, isLeapMonth: true } },
    },
    {
      title: 'lunar day 31',
      input: {
        birth: {
          ...birth,
          calendarType: 'lunar',
          date: { ...birth.date, day: 31 },
        },
      },
    },
    { title: 'client-supplied chart', input: { birth, snapshot: {} } },
  ])(
    'rejects $title using the standard validation envelope',
    async ({ input }) => {
      const response = await request(app.getHttpServer())
        .post(path)
        .send(input)
        .expect(400);
      const body = ApiErrorResponseSchema.parse(response.body);

      expect(body.code).toBe(400);
      expect(body.data?.reason).toBe('VALIDATION_ERROR');
      expect(body.data?.fieldErrors).toBeDefined();
      expect(response.headers['cache-control']).toBe('no-store');
    },
  );

  it('allows the configured browser origin and exposes request IDs', async () => {
    const response = await request(app.getHttpServer())
      .options(path)
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(response.headers['access-control-expose-headers']).toContain(
      'x-request-id',
    );
  });

  it('returns the reference hour pillar and server-calculated correction metadata', async () => {
    const response = await request(app.getHttpServer())
      .post(path)
      .send({
        birth: {
          calendarType: 'lunar',
          isLeapMonth: false,
          date: { year: 1965, month: 3, day: 10 },
          time: { precision: 'exact', hour: 7, minute: 20 },
          luckCycleGender: 'female',
        },
      })
      .expect(200);
    const { data } = PreviewSajuChartResponseSchema.parse(response.body);
    expect(data.snapshot).toMatchObject({
      normalizedBirth: {
        time: { precision: 'exact', hour: 7, minute: 20 },
        timeCorrection: {
          adjustmentMinutes: -30,
          correctedTime: { hour: 6, minute: 50 },
        },
      },
      pillars: {
        year: { hanja: '乙巳' },
        month: { hanja: '庚辰' },
        day: { hanja: '乙未' },
        hour: { hanja: '己卯' },
      },
      elementDistribution: {
        counts: { wood: 3, fire: 1, earth: 3, metal: 1, water: 0 },
      },
    });
  });

  it('publishes the calculation request and snapshot response in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/openapi.json')
      .expect(200);
    const contract = z
      .object({
        paths: z.record(
          z.string(),
          z.object({
            post: z
              .object({
                security: z.array(z.unknown()),
                requestBody: z.unknown(),
                responses: z.record(z.string(), z.unknown()),
              })
              .optional(),
          }),
        ),
      })
      .parse(response.body);

    expect(contract.paths[path]?.post?.security).toEqual([]);
    expect(contract.paths[path]?.post?.requestBody).toBeDefined();
    expect(Object.keys(contract.paths[path]?.post?.responses ?? {})).toEqual([
      '200',
      '400',
      '429',
    ]);
    expect(response.body).toMatchObject({
      components: {
        schemas: {
          PreviewSajuChartData: {
            properties: {
              status: { const: 'calculated' },
              snapshot: { $ref: '#/components/schemas/SajuChartSnapshotV1' },
            },
          },
        },
      },
    });
  });

  it('limits requests and allows them again after the window', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 120_000);
    try {
      for (let index = 0; index < 60; index += 1) {
        await request(app.getHttpServer())
          .post(path)
          .send({ birth })
          .expect(200);
      }
      const response = await request(app.getHttpServer())
        .post(path)
        .set('X-Forwarded-For', '203.0.113.20')
        .send({ birth })
        .expect(429);
      const body = ApiErrorResponseSchema.parse(response.body);
      expect(body.data?.reason).toBe('RATE_LIMITED');
      expect(response.headers['retry-after']).toBe('60');
      expect(response.headers['cache-control']).toBe('no-store');

      clock.mockReturnValue(now + 180_000);
      await request(app.getHttpServer()).post(path).send({ birth }).expect(200);
    } finally {
      clock.mockRestore();
    }
  });
});
