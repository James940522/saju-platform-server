import {
  DeleteSajuProfileDataSchema,
  UpdateSajuProfileRequestSchema,
} from './saju-profile.contract.js';

describe('UpdateSajuProfileRequestSchema', () => {
  it('accepts a partial update and trims the display name', () => {
    expect(
      UpdateSajuProfileRequestSchema.parse({ displayName: '  수정 이름  ' }),
    ).toEqual({ displayName: '수정 이름' });
  });

  it('rejects an empty update', () => {
    expect(UpdateSajuProfileRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('DeleteSajuProfileDataSchema', () => {
  it('allows the new primary profile to be null', () => {
    expect(
      DeleteSajuProfileDataSchema.parse({
        deletedProfileId: '827b4a76-b8c5-462f-afd4-af6415ca9f71',
        primarySajuProfileId: null,
      }),
    ).toMatchObject({ primarySajuProfileId: null });
  });
});
