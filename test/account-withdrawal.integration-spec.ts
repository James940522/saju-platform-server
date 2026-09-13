import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PrismaClient,
  UserStatus,
  UserConsentType,
} from '../src/generated/prisma/client.js';
import { SupabaseAuthService } from '../src/modules/auth/supabase-auth.service.js';
import {
  AccountProviderError,
  AuthAccountAdminService,
} from '../src/modules/auth/auth-account-admin.service.js';
import { AccountWithdrawalService } from '../src/modules/users/account-withdrawal.service.js';
import { AccountWithdrawalRateLimitGuard } from '../src/modules/users/account-withdrawal-rate-limit.guard.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { CreateSajuProfileResponseSchema } from '../src/modules/saju-profiles/saju-profile.contract.js';

describe('Account withdrawal with PostgreSQL', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createDatabase>;
  let sql: pg.Client;
  let owner: string;
  let other: string;
  let subjects: string[];
  let failAccept = false;
  let failFinal = false;
  const remoteUsers = new Set<string>();
  const unlinkKakao = vi.fn<(id: string) => Promise<void>>();
  const deleteAuthUser = vi.fn<(id: string) => Promise<void>>();
  const getKakaoIdentity = vi.fn<(id: string) => Promise<string | null>>();
  const input = {
    displayName: '탈퇴 테스트',
    relationType: 'self',
    birth: {
      calendarType: 'solar',
      isLeapMonth: false,
      date: { year: 1992, month: 10, day: 24 },
      time: { precision: 'exact', hour: 5, minute: 30 },
      luckCycleGender: 'male',
    },
  };

  function createDatabase(connectionString: string, schema: string) {
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString }, { schema }),
    }).$extends({
      query: {
        accountWithdrawal: {
          async create({ args, query }) {
            if (failAccept && args.data.authSubject === owner)
              throw new Error('injected acceptance failure');
            return query(args);
          },
        },
        user: {
          async deleteMany({ args, query }) {
            if (failFinal && args.where?.authSubject === owner)
              throw new Error('injected finalization failure');
            return query(args);
          },
        },
      },
    });
  }

  beforeAll(async () => {
    const connectionString = process.env.TEST_DATABASE_URL;
    const schema = process.env.TEST_DATABASE_SCHEMA;
    if (
      !connectionString ||
      !schema ||
      !(
        /^saju_test_[a-f0-9]{32}$/.test(schema) ||
        (schema === 'public' && process.env.TEST_USE_DEVELOPMENT_DB === 'true')
      )
    )
      throw new Error('Use the scoped integration runner');
    owner = z.uuid().parse(process.env.TEST_USER_ID_1);
    other = z.uuid().parse(process.env.TEST_USER_ID_2);
    subjects = [owner, other];
    prisma = createDatabase(connectionString, schema);
    sql = new pg.Client({ connectionString });
    await sql.connect();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(SupabaseAuthService)
      .useValue({
        verifyAccessToken: async (token: string) =>
          remoteUsers.has(token) ? { subject: token, displayName: null } : null,
      })
      .overrideProvider(AuthAccountAdminService)
      .useValue({
        requireEnabled: () => undefined,
        getKakaoIdentity,
        unlinkKakao,
        deleteAuthUser,
      })
      .overrideGuard(AccountWithdrawalRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(
      app,
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService),
    );
    await app.init();
  });

  beforeEach(async () => {
    failAccept = false;
    failFinal = false;
    await prisma.accountWithdrawal.deleteMany({
      where: { authSubject: { in: subjects } },
    });
    await prisma.user.deleteMany({ where: { id: { in: subjects } } });
    remoteUsers.clear();
    subjects.forEach((id) => remoteUsers.add(id));
    getKakaoIdentity
      .mockReset()
      .mockImplementation(async (subject) =>
        remoteUsers.has(subject)
          ? subject === owner
            ? '90001'
            : '90002'
          : null,
      );
    unlinkKakao.mockReset().mockResolvedValue(undefined);
    deleteAuthUser.mockReset().mockImplementation(async (subject) => {
      remoteUsers.delete(subject);
    });
    await prisma.user.createMany({
      data: subjects.map((id) => ({
        id,
        authSubject: id,
        displayName: '합성 회원',
        status: UserStatus.ACTIVE,
      })),
    });
    await prisma.userConsent.create({
      data: {
        userId: owner,
        type: UserConsentType.TERMS_OF_SERVICE,
        version: 'test',
      },
    });
  });
  afterAll(async () => {
    failFinal = false;
    if (prisma && subjects) {
      await prisma.accountWithdrawal.deleteMany({
        where: { authSubject: { in: subjects } },
      });
      await prisma.user.deleteMany({ where: { id: { in: subjects } } });
    }
    await app?.close();
    await prisma?.$disconnect();
    await sql?.end();
  });

  function withdraw(subject = owner) {
    return request(app.getHttpServer())
      .delete('/v1/users/me')
      .auth(subject, { type: 'bearer' })
      .send({ confirmDataDeletion: true });
  }
  async function createProfile(subject = owner) {
    return CreateSajuProfileResponseSchema.parse(
      (
        await request(app.getHttpServer())
          .post('/v1/saju-profiles')
          .auth(subject, { type: 'bearer' })
          .set('Idempotency-Key', randomUUID())
          .send(input)
          .expect(201)
      ).body,
    ).data;
  }
  async function resume() {
    await prisma.accountWithdrawal.updateMany({
      where: { authSubject: owner },
      data: { nextAttemptAt: new Date(0) },
    });
    return app.get(AccountWithdrawalService).process(owner);
  }
  async function expectPersonalDataDeleted() {
    expect(
      await prisma.sajuProfile.count({ where: { ownerUserId: owner } }),
    ).toBe(0);
    expect(
      await prisma.sajuProfileCreation.count({ where: { ownerUserId: owner } }),
    ).toBe(0);
    expect(await prisma.userConsent.count({ where: { userId: owner } })).toBe(
      0,
    );
  }

  it('removes every chart, consent and request record while preserving another member', async () => {
    const first = await createProfile();
    const deleted = await createProfile();
    const untouched = await createProfile(other);
    await request(app.getHttpServer())
      .patch(`/v1/saju-profiles/${first.profile.id}`)
      .auth(owner, { type: 'bearer' })
      .send({ birth: { ...input.birth, time: { precision: 'unknown' } } })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/v1/saju-profiles/${deleted.profile.id}`)
      .auth(owner, { type: 'bearer' })
      .expect(200);
    const response = await withdraw().expect(200);
    expect(response.body).toMatchObject({
      code: 200,
      data: { status: 'completed' },
    });
    await expectPersonalDataDeleted();
    expect(
      await prisma.sajuChart.count({
        where: { profileId: { in: [first.profile.id, deleted.profile.id] } },
      }),
    ).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: owner } })).toBeNull();
    expect(
      await prisma.accountWithdrawal.findUnique({
        where: { authSubject: owner },
      }),
    ).toBeNull();
    expect(
      await prisma.sajuChart.findUnique({ where: { id: untouched.chart.id } }),
    ).not.toBeNull();
    expect(unlinkKakao).toHaveBeenCalledWith('90001');
    expect(deleteAuthUser).toHaveBeenCalledWith(owner);
    expect(remoteUsers.has(other)).toBe(true);
    await withdraw().expect(401);
  });

  it.each([UserStatus.PENDING_REGISTRATION, UserStatus.SUSPENDED])(
    'allows a %s member to delete their own account',
    async (status) => {
      await prisma.user.update({ where: { id: owner }, data: { status } });
      await withdraw().expect(200);
      expect(await prisma.user.findUnique({ where: { id: owner } })).toBeNull();
    },
  );

  it('also deletes an Auth-only account that has not completed registration', async () => {
    await prisma.user.delete({ where: { id: owner } });
    await withdraw().expect(200);
    expect(
      await prisma.user.findUnique({ where: { authSubject: owner } }),
    ).toBeNull();
  });

  it('rolls back acceptance if persisting the recovery job fails', async () => {
    const saved = await createProfile();
    failAccept = true;
    await withdraw().expect(500);
    expect(
      await prisma.sajuChart.findUnique({ where: { id: saved.chart.id } }),
    ).not.toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: owner } })).status,
    ).toBe(UserStatus.ACTIVE);
    expect(await prisma.userConsent.count({ where: { userId: owner } })).toBe(
      1,
    );
    expect(unlinkKakao).not.toHaveBeenCalled();
  });

  it('retains no birth data during an unlink outage and resumes without the browser', async () => {
    await createProfile();
    unlinkKakao.mockRejectedValueOnce(
      new AccountProviderError('KAKAO_UNLINK_UNAVAILABLE'),
    );
    await withdraw().expect(202);
    await expectPersonalDataDeleted();
    expect(
      await prisma.user.findUnique({
        where: { id: owner },
        select: { status: true, displayName: true, primarySajuProfileId: true },
      }),
    ).toEqual({
      status: UserStatus.WITHDRAWN,
      displayName: null,
      primarySajuProfileId: null,
    });
    await request(app.getHttpServer())
      .get('/v1/users/me')
      .auth(owner, { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .put('/v1/users/me/registration')
      .auth(owner, { type: 'bearer' })
      .send({
        termsAccepted: true,
        privacyPolicyAccepted: true,
        isAtLeast14: true,
      })
      .expect(403);
    await request(app.getHttpServer())
      .post('/v1/saju-profiles')
      .auth(owner, { type: 'bearer' })
      .send(input)
      .expect(403);
    expect(deleteAuthUser).not.toHaveBeenCalled();
    await expect(resume()).resolves.toEqual({ status: 'completed' });
  });

  it('does not repeat unlink after Auth deletion fails', async () => {
    deleteAuthUser.mockRejectedValueOnce(
      new AccountProviderError('AUTH_DELETE_UNAVAILABLE'),
    );
    await withdraw().expect(202);
    expect(
      (
        await prisma.accountWithdrawal.findUniqueOrThrow({
          where: { authSubject: owner },
        })
      ).phase,
    ).toBe('delete_auth');
    await expect(resume()).resolves.toEqual({ status: 'completed' });
    expect(unlinkKakao).toHaveBeenCalledTimes(1);
    expect(deleteAuthUser).toHaveBeenCalledTimes(2);
  });

  it('resumes final DB deletion even after the Auth account no longer exists', async () => {
    failFinal = true;
    await withdraw().expect(202);
    expect(remoteUsers.has(owner)).toBe(false);
    expect(
      (
        await prisma.accountWithdrawal.findUniqueOrThrow({
          where: { authSubject: owner },
        })
      ).phase,
    ).toBe('delete_user');
    failFinal = false;
    await expect(resume()).resolves.toEqual({ status: 'completed' });
    expect(unlinkKakao).toHaveBeenCalledTimes(1);
    expect(deleteAuthUser).toHaveBeenCalledTimes(1);
  });

  it('claims concurrent duplicate requests once', async () => {
    const responses = await Promise.all([withdraw(), withdraw()]);
    expect(
      responses.every((response) => [200, 202, 401].includes(response.status)),
    ).toBe(true);
    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(unlinkKakao).toHaveBeenCalledTimes(1);
    expect(deleteAuthUser).toHaveBeenCalledTimes(1);
    expect(await prisma.user.findUnique({ where: { id: owner } })).toBeNull();
  });

  it('recovers an expired process lease without claiming an active one', async () => {
    unlinkKakao.mockRejectedValueOnce(
      new AccountProviderError('KAKAO_UNLINK_UNAVAILABLE'),
    );
    await withdraw().expect(202);
    await prisma.accountWithdrawal.update({
      where: { authSubject: owner },
      data: {
        leaseId: randomUUID(),
        leaseUntil: new Date(Date.now() + 60_000),
        nextAttemptAt: new Date(0),
      },
    });
    await expect(
      app.get(AccountWithdrawalService).process(owner),
    ).resolves.toEqual({ status: 'processing' });
    expect(unlinkKakao).toHaveBeenCalledTimes(1);
    await prisma.accountWithdrawal.update({
      where: { authSubject: owner },
      data: { leaseUntil: new Date(0) },
    });
    await expect(resume()).resolves.toEqual({ status: 'completed' });
  });

  it('refuses to unlink a stored Kakao ID if its original Auth identity disappeared', async () => {
    unlinkKakao.mockRejectedValueOnce(
      new AccountProviderError('KAKAO_UNLINK_UNAVAILABLE'),
    );
    await withdraw().expect(202);
    remoteUsers.delete(owner);
    await expect(resume()).resolves.toEqual({ status: 'processing' });
    expect(unlinkKakao).toHaveBeenCalledTimes(1);
    expect(deleteAuthUser).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted user from a delayed registration request', async () => {
    await withdraw().expect(200);
    await expect(
      app
        .get(UsersService)
        .completeRegistration(
          owner,
          '옛 이름',
          {
            termsAccepted: true,
            privacyPolicyAccepted: true,
            isAtLeast14: true,
          },
          owner,
        ),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await prisma.user.findUnique({ where: { authSubject: owner } }),
    ).toBeNull();
  });

  it('denies browser roles access to the temporary recovery table', async () => {
    const result = await sql.query<{ enabled: boolean }>(
      "SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'account_withdrawals' AND relnamespace = current_schema()::regnamespace",
    );
    expect(result.rows[0]?.enabled).toBe(true);
    const roles = await sql.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
    );
    for (const role of roles.rows) {
      const grants = await sql.query<{ allowed: boolean }>(
        "SELECT has_table_privilege($1, 'account_withdrawals', 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
        [role.rolname],
      );
      expect(grants.rows[0]?.allowed).toBe(false);
    }
  });
});
