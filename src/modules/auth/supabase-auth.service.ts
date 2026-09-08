import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import type { AuthPrincipal } from './auth-principal.js';

const SupabaseUserSchema = z.object({
  id: z.uuid(),
  user_metadata: z.unknown().optional(),
});

const SupabaseUserMetadataSchema = z
  .object({
    preferred_username: z.unknown().optional(),
    user_name: z.unknown().optional(),
    full_name: z.unknown().optional(),
    name: z.unknown().optional(),
  })
  .passthrough();

const DisplayNameSchema = z.string().trim().min(1).max(50);

function getDisplayName(userMetadata: unknown): string | null {
  const parsedMetadata = SupabaseUserMetadataSchema.safeParse(userMetadata);

  if (!parsedMetadata.success) {
    return null;
  }

  const candidates = [
    parsedMetadata.data.preferred_username,
    parsedMetadata.data.user_name,
    parsedMetadata.data.full_name,
    parsedMetadata.data.name,
  ];

  for (const candidate of candidates) {
    const parsedDisplayName = DisplayNameSchema.safeParse(candidate);

    if (parsedDisplayName.success) {
      return parsedDisplayName.data;
    }
  }

  return null;
}

@Injectable()
export class SupabaseAuthService {
  private readonly userEndpoint: URL;
  private readonly publishableKey: string;

  constructor(configService: ConfigService<EnvironmentVariables, true>) {
    this.userEndpoint = new URL(
      '/auth/v1/user',
      configService.get('SUPABASE_URL', { infer: true }),
    );
    this.publishableKey = configService.get('SUPABASE_PUBLISHABLE_KEY', {
      infer: true,
    });
  }

  async verifyAccessToken(accessToken: string): Promise<AuthPrincipal | null> {
    let response: Response;

    try {
      response = await fetch(this.userEndpoint, {
        headers: {
          apikey: this.publishableKey,
          authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw this.createProviderUnavailableException();
    }

    if (response.status === 401 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      throw this.createProviderUnavailableException();
    }

    try {
      const user = SupabaseUserSchema.parse(await response.json());

      return {
        subject: user.id,
        displayName: getDisplayName(user.user_metadata),
      };
    } catch {
      throw this.createProviderUnavailableException();
    }
  }

  private createProviderUnavailableException() {
    return new ServiceUnavailableException({
      message: '인증 서비스에 일시적으로 연결할 수 없습니다.',
      reason: 'AUTH_PROVIDER_UNAVAILABLE',
    });
  }
}
