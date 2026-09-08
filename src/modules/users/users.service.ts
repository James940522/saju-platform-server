import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  UserStatus as PrismaUserStatus,
  UserConsentType,
  type User as PrismaUser,
} from '../../generated/prisma/client.js';
import type {
  AppUser,
  CompleteRegistrationRequest,
  CurrentUserData,
  UserStatus,
} from './user.contract.js';

const CURRENT_TERMS_VERSION = 'v1';
const CURRENT_PRIVACY_POLICY_VERSION = 'v1';
const CURRENT_AGE_REQUIREMENT_VERSION = 'age-14-v1';

const USER_STATUS_BY_PRISMA_STATUS: Record<PrismaUserStatus, UserStatus> = {
  [PrismaUserStatus.PENDING_REGISTRATION]: 'pending_registration',
  [PrismaUserStatus.ACTIVE]: 'active',
  [PrismaUserStatus.SUSPENDED]: 'suspended',
  [PrismaUserStatus.WITHDRAWN]: 'withdrawn',
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCurrentUser(
    authSubject: string,
    displayName: string | null,
  ): Promise<CurrentUserData> {
    const user = await this.prisma.user.upsert({
      where: { authSubject },
      create: { authSubject, displayName },
      update: {},
    });

    return { user: this.toAppUser(user) };
  }

  async getCurrentUser(authSubject: string): Promise<CurrentUserData> {
    const user = await this.prisma.user.findUnique({
      where: { authSubject },
    });

    if (!user) {
      throw new NotFoundException({
        message: '사용자 정보를 찾을 수 없습니다.',
        reason: 'USER_NOT_FOUND',
      });
    }

    return { user: this.toAppUser(user) };
  }

  async completeRegistration(
    authSubject: string,
    _request: CompleteRegistrationRequest,
  ): Promise<CurrentUserData> {
    const user = await this.prisma.$transaction(async (transaction) => {
      const currentUser = await transaction.user.findUnique({
        where: { authSubject },
      });

      if (!currentUser) {
        throw this.createUserNotFoundException();
      }

      await transaction.userConsent.createMany({
        data: [
          {
            userId: currentUser.id,
            type: UserConsentType.TERMS_OF_SERVICE,
            version: CURRENT_TERMS_VERSION,
          },
          {
            userId: currentUser.id,
            type: UserConsentType.PRIVACY_POLICY,
            version: CURRENT_PRIVACY_POLICY_VERSION,
          },
          {
            userId: currentUser.id,
            type: UserConsentType.AGE_REQUIREMENT,
            version: CURRENT_AGE_REQUIREMENT_VERSION,
          },
        ],
        skipDuplicates: true,
      });

      return transaction.user.update({
        where: { id: currentUser.id },
        data: { status: PrismaUserStatus.ACTIVE },
      });
    });

    return { user: this.toAppUser(user) };
  }

  private toAppUser(user: PrismaUser): AppUser {
    return {
      id: user.id,
      displayName: user.displayName,
      status: USER_STATUS_BY_PRISMA_STATUS[user.status],
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      withdrawnAt: user.withdrawnAt?.toISOString() ?? null,
    };
  }

  private createUserNotFoundException() {
    return new NotFoundException({
      message: '사용자 정보를 찾을 수 없습니다.',
      reason: 'USER_NOT_FOUND',
    });
  }
}
