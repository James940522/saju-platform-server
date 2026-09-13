import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { EnvironmentVariables } from '../../config/environment.schema.js';

const KakaoUserIdSchema = z.string().regex(/^[1-9][0-9]{0,18}$/);
const AdminUserSchema = z.object({
  id: z.uuid(),
  identities: z.array(
    z.object({ id: z.string(), user_id: z.uuid(), provider: z.string() }),
  ),
});
const AuthErrorSchema = z.object({ code: z.literal('user_not_found') });
const KakaoErrorSchema = z.object({ code: z.number().int() });

export class AccountProviderError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

@Injectable()
export class AuthAccountAdminService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  isEnabled() {
    return this.config.get('ACCOUNT_WITHDRAWAL_ENABLED', { infer: true });
  }

  requireEnabled() {
    if (!this.isEnabled())
      throw new ServiceUnavailableException({
        message:
          '지금은 회원 탈퇴를 처리할 수 없습니다. 잠시 후 다시 시도해주세요.',
        reason: 'ACCOUNT_WITHDRAWAL_UNAVAILABLE',
      });
  }

  async getKakaoIdentity(subject: string): Promise<string | null> {
    const response = await this.authRequest(subject, 'GET');
    if (await this.isMissingUser(response)) return null;
    if (!response.ok) throw new AccountProviderError('AUTH_ADMIN_UNAVAILABLE');
    const result = AdminUserSchema.safeParse(await this.json(response));
    if (
      !result.success ||
      result.data.id !== subject ||
      result.data.identities.length !== 1
    ) {
      throw new AccountProviderError('AUTH_IDENTITY_UNSUPPORTED');
    }
    const identity = result.data.identities[0];
    // id is the provider-owned identifier, not user-editable user_metadata.
    if (
      !identity ||
      identity.provider !== 'kakao' ||
      identity.user_id !== subject
    ) {
      throw new AccountProviderError('AUTH_IDENTITY_UNSUPPORTED');
    }
    const id = KakaoUserIdSchema.safeParse(identity.id);
    if (!id.success) throw new AccountProviderError('AUTH_IDENTITY_INVALID');
    return id.data;
  }

  async unlinkKakao(userId: string) {
    const key = this.config.get('KAKAO_ADMIN_KEY', { infer: true });
    if (!key) throw new AccountProviderError('KAKAO_NOT_CONFIGURED');
    const response = await this.fetch('https://kapi.kakao.com/v1/user/unlink', {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({
        target_id_type: 'user_id',
        target_id: KakaoUserIdSchema.parse(userId),
      }),
    });
    const text = await response.text();
    if (response.ok) {
      // Kakao emits a JSON integer. Preserve the decimal digits beyond 2^53.
      const match = text.match(
        /^\s*\{\s*"id"\s*:\s*([1-9][0-9]{0,18})\s*\}\s*$/,
      );
      if (match?.[1] !== userId)
        throw new AccountProviderError('KAKAO_RESPONSE_INVALID');
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new AccountProviderError('KAKAO_RESPONSE_INVALID');
    }
    // Kakao -101 means no user connected to this app; other errors are failures.
    const error = KakaoErrorSchema.safeParse(body);
    if (response.status === 400 && error.success && error.data.code === -101)
      return;
    throw new AccountProviderError('KAKAO_UNLINK_UNAVAILABLE');
  }

  async deleteAuthUser(subject: string) {
    const response = await this.authRequest(subject, 'DELETE');
    if (await this.isMissingUser(response)) return;
    if (!response.ok) throw new AccountProviderError('AUTH_DELETE_UNAVAILABLE');
  }

  private async authRequest(subject: string, method: 'GET' | 'DELETE') {
    const key = this.config.get('SUPABASE_SERVICE_ROLE_KEY', { infer: true });
    if (!key) throw new AccountProviderError('AUTH_ADMIN_NOT_CONFIGURED');
    const url = new URL(
      `/auth/v1/admin/users/${z.uuid().parse(subject)}`,
      this.config.get('SUPABASE_URL', { infer: true }),
    );
    return this.fetch(url, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      ...(method === 'DELETE'
        ? { body: JSON.stringify({ should_soft_delete: false }) }
        : {}),
    });
  }

  private async isMissingUser(response: Response) {
    return (
      response.status === 404 &&
      AuthErrorSchema.safeParse(await this.json(response)).success
    );
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AccountProviderError('PROVIDER_RESPONSE_INVALID');
    }
  }

  private async fetch(url: string | URL, init: RequestInit) {
    try {
      return await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(2_000),
      });
    } catch {
      throw new AccountProviderError('PROVIDER_REQUEST_FAILED');
    }
  }
}
