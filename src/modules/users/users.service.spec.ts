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
  it('idempotently provisions a pending app user for the auth subject', async () => {
    const upsert = vi.fn().mockResolvedValue(prismaUser);
    const prisma = {
      user: {
        upsert,
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await expect(
      service.ensureCurrentUser(AUTH_SUBJECT, '카카오 사용자'),
    ).resolves.toEqual({
      user: {
        id: USER_ID,
        displayName: '카카오 사용자',
        status: 'pending_registration',
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
  });

  it('records required registration confirmations and activates the user', async () => {
    const activeUser: PrismaUser = {
      ...prismaUser,
      status: PrismaUserStatus.ACTIVE,
    };
    const findUnique = vi.fn().mockResolvedValue(prismaUser);
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const update = vi.fn().mockResolvedValue(activeUser);
    const transactionClient = {
      user: { findUnique, update },
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
      service.completeRegistration(AUTH_SUBJECT, {
        termsAccepted: true,
        privacyPolicyAccepted: true,
        isAtLeast14: true,
      }),
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
    expect(findUnique).toHaveBeenCalledWith({
      where: { authSubject: AUTH_SUBJECT },
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
});
