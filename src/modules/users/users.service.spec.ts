import { PrismaService } from '../../database/prisma.service.js';
import {
  UserConsentType,
  UserStatus as PrismaUserStatus,
  type User as PrismaUser,
} from '../../generated/prisma/client.js';
import { UsersService } from './users.service.js';

const AUTH_SUBJECT = 'd952b765-7b9a-44fc-9d94-632036ac0934';
const USER_ID = '53195553-c632-4f09-8c0e-9f5a1cdaf876';
const CREATED_AT = new Date('2026-09-08T01:00:00.000Z');
const UPDATED_AT = new Date('2026-09-08T01:01:00.000Z');
const REGISTRATION_REQUEST = {
  termsAccepted: true,
  privacyPolicyAccepted: true,
  isAtLeast14: true,
} as const;

const prismaUser: PrismaUser = {
  id: USER_ID,
  authSubject: AUTH_SUBJECT,
  displayName: '카카오 사용자',
  status: PrismaUserStatus.PENDING_REGISTRATION,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  withdrawnAt: null,
};

describe('UsersService', () => {
  it('returns the current app user without creating one', async () => {
    const findUnique = vi.fn().mockResolvedValue(prismaUser);
    const prisma = {
      user: {
        findUnique,
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(service.getCurrentUser(AUTH_SUBJECT)).resolves.toEqual({
      user: {
        id: USER_ID,
        displayName: '카카오 사용자',
        status: 'pending_registration',
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
        withdrawnAt: null,
      },
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { authSubject: AUTH_SUBJECT },
    });
  });

  it('returns not found when registration has not created an app user', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(service.getCurrentUser(AUTH_SUBJECT)).rejects.toMatchObject({
      status: 404,
      response: { reason: 'USER_NOT_FOUND' },
    });
  });

  it('creates a new app user, records confirmations, and activates it atomically', async () => {
    const activeUser: PrismaUser = {
      ...prismaUser,
      status: PrismaUserStatus.ACTIVE,
    };
    const upsert = vi.fn().mockResolvedValue(prismaUser);
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const update = vi.fn().mockResolvedValue(activeUser);
    const transactionClient = {
      user: { upsert, update },
      userConsent: { createMany },
    };
    const transaction = vi.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<PrismaUser>,
      ) => callback(transactionClient),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.completeRegistration(
        AUTH_SUBJECT,
        '카카오 사용자',
        REGISTRATION_REQUEST,
      ),
    ).resolves.toEqual({
      user: {
        id: USER_ID,
        displayName: '카카오 사용자',
        status: 'active',
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
        withdrawnAt: null,
      },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { authSubject: AUTH_SUBJECT },
      create: {
        authSubject: AUTH_SUBJECT,
        displayName: '카카오 사용자',
      },
      update: {},
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          userId: USER_ID,
          type: UserConsentType.TERMS_OF_SERVICE,
          version: 'v1',
        },
        {
          userId: USER_ID,
          type: UserConsentType.PRIVACY_POLICY,
          version: 'v1',
        },
        {
          userId: USER_ID,
          type: UserConsentType.AGE_REQUIREMENT,
          version: 'age-14-v1',
        },
      ],
      skipDuplicates: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { status: PrismaUserStatus.ACTIVE },
    });
  });

  it('returns an existing active user without rewriting confirmations', async () => {
    const activeUser: PrismaUser = {
      ...prismaUser,
      status: PrismaUserStatus.ACTIVE,
    };
    const upsert = vi.fn().mockResolvedValue(activeUser);
    const createMany = vi.fn();
    const update = vi.fn();
    const transactionClient = {
      user: { upsert, update },
      userConsent: { createMany },
    };
    const transaction = vi.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<PrismaUser>,
      ) => callback(transactionClient),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.completeRegistration(
        AUTH_SUBJECT,
        '카카오 사용자',
        REGISTRATION_REQUEST,
      ),
    ).resolves.toEqual({
      user: {
        id: USER_ID,
        displayName: '카카오 사용자',
        status: 'active',
        createdAt: CREATED_AT.toISOString(),
        updatedAt: UPDATED_AT.toISOString(),
        withdrawnAt: null,
      },
    });
    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([PrismaUserStatus.SUSPENDED, PrismaUserStatus.WITHDRAWN])(
    'does not reactivate a %s user through registration',
    async (status) => {
      const upsert = vi.fn().mockResolvedValue({ ...prismaUser, status });
      const transactionClient = {
        user: { upsert, update: vi.fn() },
        userConsent: { createMany: vi.fn() },
      };
      const transaction = vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<PrismaUser>,
        ) => callback(transactionClient),
      );
      const prisma = { $transaction: transaction } as unknown as PrismaService;
      const service = new UsersService(prisma);

      await expect(
        service.completeRegistration(
          AUTH_SUBJECT,
          '카카오 사용자',
          REGISTRATION_REQUEST,
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { reason: 'USER_REGISTRATION_NOT_ALLOWED' },
      });
      expect(transactionClient.userConsent.createMany).not.toHaveBeenCalled();
      expect(transactionClient.user.update).not.toHaveBeenCalled();
    },
  );
});
