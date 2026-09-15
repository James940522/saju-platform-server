import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { config } from 'dotenv';
import pg from 'pg';

// Dedicated TEST_DATABASE_URL: migrate a private schema, then remove that schema.
// Explicit --development-db: use already-migrated public tables and only two
// run-specific user UUIDs. Never clear application tables or install DB triggers.
const useDevelopmentDatabase = process.argv.includes('--development-db');
let connectionString = process.env.TEST_DATABASE_URL;
if (useDevelopmentDatabase) {
  const environment = config({ quiet: true }).parsed;
  if (
    environment?.NODE_ENV !== 'development' ||
    process.env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'The development DB option requires NODE_ENV=development in .env.',
    );
  }
  connectionString = environment.DIRECT_URL ?? environment.DATABASE_URL;
}
if (!connectionString)
  throw new Error('Set TEST_DATABASE_URL or explicitly pass --development-db.');

const schema = useDevelopmentDatabase
  ? 'public'
  : `saju_test_${randomUUID().replaceAll('-', '')}`;
const userIds = [randomUUID(), randomUUID()];
const client = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
});
let createdSchema = false;
let canCleanTestUsers = false;
let stage = 'connect';
try {
  await client.connect();
  if (!useDevelopmentDatabase) {
    stage = 'create schema';
    await client.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
  }
  await client.query(`SET search_path TO "${schema}"`);
  if (createdSchema) {
    const migrations = (
      await readdir(new URL('../prisma/migrations/', import.meta.url))
    )
      .filter((entry) => /^\d+_/.test(entry))
      .sort();
    for (const migration of migrations) {
      stage = `migration ${migration}`;
      await client.query(
        await readFile(
          new URL(
            `../prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
    }
    console.log(
      `Applied ${migrations.length} migrations to isolated test schema.`,
    );
  } else {
    stage = 'check applied migration';
    const result = await client.query(
      "SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260914100000_create_reading_jobs' AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    if (result.rowCount !== 1)
      throw new Error('Required storage migration is not applied.');
  }
  stage = 'reserve test user IDs';
  const existing = await client.query(
    'SELECT id FROM users WHERE id = ANY($1::uuid[])',
    [userIds],
  );
  if (existing.rowCount !== 0) throw new Error('Test user UUID collision.');
  canCleanTestUsers = true;
  const url = new URL(connectionString);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--config',
        'vitest.config.integration.ts',
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TEST_DATABASE_URL: url.toString(),
          TEST_DATABASE_SCHEMA: schema,
          TEST_USE_DEVELOPMENT_DB: String(useDevelopmentDatabase),
          TEST_USER_ID_1: userIds[0],
          TEST_USER_ID_2: userIds[1],
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (status) => resolve(status ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  // Do not print connection details or query input from provider errors.
  console.error('Storage integration setup failed:', {
    stage,
    name: error instanceof Error ? error.name : 'UnknownError',
    code: error?.code,
  });
  process.exitCode = 1;
} finally {
  await client.query('ROLLBACK').catch(() => undefined);
  if (createdSchema) {
    await client.query('SET search_path TO pg_catalog');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log('Isolated test schema removed.');
  } else if (canCleanTestUsers) {
    await client.query('DELETE FROM account_withdrawals WHERE auth_subject = ANY($1::uuid[])', [userIds]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      userIds,
    ]);
    const remaining = await client.query(
      'SELECT id FROM users WHERE id = ANY($1::uuid[])',
      [userIds],
    );
    if (remaining.rowCount !== 0)
      throw new Error('Test user cleanup incomplete.');
    console.log(
      'Run-specific test users and all dependent test records removed.',
    );
  }
  await client.end();
}
