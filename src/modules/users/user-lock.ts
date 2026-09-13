import type { Prisma } from '../../generated/prisma/client.js';

// Also locks missing users, preventing delayed registration from recreating them.
export async function lockAuthSubject(
  transaction: Prisma.TransactionClient,
  subject: string,
) {
  await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${subject}, 0))`;
  await transaction.$queryRaw`SELECT id FROM users WHERE auth_subject = ${subject}::uuid FOR UPDATE`;
}
