import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/environment.schema.js';
import { SupabaseAuthService } from './supabase-auth.service.js';

const AUTH_SUBJECT = 'd952b765-7b9a-44fc-9d94-632036ac0934';

function createService() {
  const configService = new ConfigService<EnvironmentVariables, true>({
    NODE_ENV: 'test',
    PORT: 8080,
    CORS_ORIGINS: ['http://localhost:3000'],
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
    DIRECT_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
  });

  return new SupabaseAuthService(configService);
}

describe('SupabaseAuthService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps a verified Supabase user to an auth principal', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: AUTH_SUBJECT,
          user_metadata: { preferred_username: ' 카카오 사용자 ' },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    await expect(
      createService().verifyAccessToken('valid-token'),
    ).resolves.toEqual({ subject: AUTH_SUBJECT, displayName: '카카오 사용자' });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://example.supabase.co/auth/v1/user'),
      expect.objectContaining({
        headers: {
          apikey: 'test-publishable-key',
          authorization: 'Bearer valid-token',
        },
      }),
    );
  });

  it('allows a verified user without a usable display name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: AUTH_SUBJECT,
          user_metadata: { preferred_username: ' '.repeat(3) },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      createService().verifyAccessToken('valid-token'),
    ).resolves.toEqual({ subject: AUTH_SUBJECT, displayName: null });
  });

  it('returns null when Supabase rejects the token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(
      createService().verifyAccessToken('invalid-token'),
    ).resolves.toBeNull();
  });

  it('hides provider failures behind the auth boundary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(
      createService().verifyAccessToken('valid-token'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
