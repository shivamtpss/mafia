import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration. Connection URLs live here (not in schema.prisma).
 * The URL is read from DATABASE_URL and consumed by Prisma Migrate / CLI.
 * The runtime PrismaClient receives its connection via a driver adapter when the
 * persistence layer is wired up (Phase 6); Phase 1 runs fully in-memory.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
