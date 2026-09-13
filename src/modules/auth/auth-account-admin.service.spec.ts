import { ConfigService } from '@nestjs/config';
import { AuthAccountAdminService } from './auth-account-admin.service.js';

const SUBJECT = 'dc3fd0fd-588d-4c71-a15f-d6b0bc58f257';
const service = new AuthAccountAdminService(
  new ConfigService({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    KAKAO_ADMIN_KEY: 'test-kakao-key',
    ACCOUNT_WITHDRAWAL_ENABLED: true,
  }),
);

describe('Account provider deletion', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses provider-owned identity instead of editable metadata', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        id: SUBJECT,
        user_metadata: { provider_id: '999' },
        identities: [{ id: '12345', provider: 'kakao', user_id: SUBJECT }],
      }),
    );
    await expect(service.getKakaoIdentity(SUBJECT)).resolves.toBe('12345');
    expect(fetchMock.mock.calls[0]?.[0].toString()).toBe(
      `https://example.supabase.co/auth/v1/admin/users/${SUBJECT}`,
    );
  });

  it.each([
    { id: SUBJECT, identities: [] },
    {
      id: SUBJECT,
      identities: [{ id: '12345', provider: 'google', user_id: SUBJECT }],
    },
    {
      id: SUBJECT,
      identities: [
        {
          id: '12345',
          provider: 'kakao',
          user_id: 'e8c2431b-f422-4e75-91a8-d24e2256d3e3',
        },
      ],
    },
  ])('rejects unsupported identity without unlinking', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(service.getKakaoIdentity(SUBJECT)).rejects.toThrow(
      'AUTH_IDENTITY',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a 64-bit Kakao ID in the request and response', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"id":9223372036854775807}', { status: 200 }),
    );
    await expect(
      service.unlinkKakao('9223372036854775807'),
    ).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.body?.toString()).toBe(
      'target_id_type=user_id&target_id=9223372036854775807',
    );
  });

  it('accepts specifically an already unlinked account', async () => {
    fetchMock.mockResolvedValue(Response.json({ code: -101 }, { status: 400 }));
    await expect(service.unlinkKakao('123')).resolves.toBeUndefined();
  });

  it.each([
    [-401, 401],
    [-2, 400],
    [-101, 500],
  ])(
    'does not treat provider error %s/%s as deletion',
    async (code, status) => {
      fetchMock.mockResolvedValue(
        Response.json({ code, msg: 'private provider text' }, { status }),
      );
      await expect(service.unlinkKakao('123')).rejects.toThrow(
        'KAKAO_UNLINK_UNAVAILABLE',
      );
    },
  );

  it('requests a hard Auth delete and accepts only the documented missing-user error', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 'user_not_found' }, { status: 404 }),
    );
    await expect(service.deleteAuthUser(SUBJECT)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      body: '{"should_soft_delete":false}',
      redirect: 'error',
    });
    fetchMock.mockResolvedValue(
      Response.json({ code: 'wrong_route' }, { status: 404 }),
    );
    await expect(service.deleteAuthUser(SUBJECT)).rejects.toThrow(
      'AUTH_DELETE_UNAVAILABLE',
    );
  });

  it('does not expose network errors or keys', async () => {
    fetchMock.mockRejectedValue(new Error('private provider text'));
    await expect(service.deleteAuthUser(SUBJECT)).rejects.toThrow(
      'PROVIDER_REQUEST_FAILED',
    );
  });
});
