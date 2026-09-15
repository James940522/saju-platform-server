import { createServer, type Socket } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service.js';
import type { EnvironmentVariables } from '../src/config/environment.schema.js';

it.each(['handshake', 'query'] as const)(
  'rejects a stalled PostgreSQL %s and releases its socket',
  async (stage) => {
    const sockets = new Set<Socket>();
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      if (connections > 1) {
        socket.destroy();
      } else if (stage === 'query') {
        // Complete startup (AuthenticationOk + ReadyForQuery), then emulate
        // a lost network that never answers the SQL query. No real DB is used.
        socket.once('data', () => {
          socket.write(Buffer.from('5200000008000000005a0000000549', 'hex'));
        });
      }
      socket.resume();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing fixture address');
    const db = new PrismaService(
      new ConfigService<EnvironmentVariables, true>({
        NODE_ENV: 'test',
        DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:${address.port}/fixture?sslmode=disable`,
      }),
    );
    try {
      await expect(db.$queryRaw`SELECT 1`).rejects.toThrow();
      expect(connections).toBe(1);
      // A retry must acquire a new socket, not reuse the stalled one.
      await expect(db.$queryRaw`SELECT 1`).rejects.toThrow();
      expect(connections).toBe(2);
    } finally {
      for (const socket of sockets) socket.destroy();
      await db.$disconnect();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  25_000,
);
