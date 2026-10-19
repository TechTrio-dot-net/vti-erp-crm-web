import { inject } from 'vitest';

// Runs before each spec imports the app, so the database pool and JWT secrets pick these up
process.env.DATABASE_URL = inject('databaseUrl');
process.env.STORAGE_PATH = inject('storagePath');
process.env.JWT_ACCESS_SECRET = 'test-access-secret-not-used-anywhere-real';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-used-anywhere-real';
process.env.DB_POOL_MIN = '0';
process.env.AUTH_RATE_LIMIT = '100000';
process.env.APP_TIMEZONE = 'Asia/Kolkata';
// Jobs started by request traffic would race with the per-test table resets
process.env.DISABLE_BACKGROUND_JOBS = 'true';
// No email provider in tests
delete process.env.RESEND_API_KEY;
