import { z } from 'zod';
import { createApiResponseSchema } from '../../common/contracts/api-response.schema.js';

export const UserStatusSchema = z
  .enum(['pending_registration', 'active', 'suspended', 'withdrawn'])
  .meta({ id: 'UserStatus' });

export const UserSchema = z
  .strictObject({
    id: z.uuid(),
    displayName: z.string().min(1).max(50).nullable(),
    status: UserStatusSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    withdrawnAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'User' });

export const CurrentUserDataSchema = z
  .strictObject({
    user: UserSchema,
  })
  .meta({ id: 'CurrentUserData' });

export const CurrentUserResponseSchema = createApiResponseSchema(
  'CurrentUserResponse',
  200,
  CurrentUserDataSchema,
);

export const CompleteRegistrationRequestSchema = z
  .strictObject({
    termsAccepted: z.literal(true),
    privacyPolicyAccepted: z.literal(true),
    isAtLeast14: z.literal(true),
  })
  .meta({ id: 'CompleteRegistrationRequest' });

export type UserStatus = z.output<typeof UserStatusSchema>;
export type AppUser = z.output<typeof UserSchema>;
export type CurrentUserData = z.output<typeof CurrentUserDataSchema>;
export type CompleteRegistrationRequest = z.output<
  typeof CompleteRegistrationRequestSchema
>;
