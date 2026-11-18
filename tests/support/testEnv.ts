/**
 * Connection settings for the disposable test services in
 * docker-compose.test.yml. Override with TEST_DATABASE_URL / TEST_KV_URL (for
 * example, CI service containers).
 *
 * Test code is allowed to reset this database, so `assertDisposableDatabase`
 * refuses anything that does not look like a local, test-only database, and
 * `assertDisposableRedis` refuses a non-local Redis.
 */
// 127.0.0.1, not localhost: docker-compose.test.yml publishes on IPv4 loopback
// only, and Prisma reports a refused ::1 instead of the real error.
export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55432/buzz_board_test";
export const DEFAULT_TEST_KV_URL = "redis://127.0.0.1:56379/0";

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
}

export function testKvUrl(): string {
  return process.env.TEST_KV_URL ?? DEFAULT_TEST_KV_URL;
}

export function testServiceEnv(): Record<string, string> {
  return {
    NODE_ENV: "test",
    DATABASE_URL: testDatabaseUrl(),
    KV_URL: testKvUrl(),
    NEXT_PUBLIC_QRCODE_BASE_URL: "http://localhost:3000",
    AUTH_SECRET: "test-only-auth-secret-not-for-production",
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertDisposableDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const databaseName = url.pathname.replace(/^\//, "");

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Refusing to reset non-local test database host "${url.hostname}".`,
    );
  }
  if (!/test/i.test(databaseName)) {
    throw new Error(
      `Refusing to reset database "${databaseName}": its name must contain "test".`,
    );
  }
}

/** Redis has no database name to check, so only the host is guarded. */
export function assertDisposableRedis(kvUrl: string): void {
  const { hostname } = new URL(kvUrl);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to use non-local test Redis host "${hostname}".`);
  }
}
