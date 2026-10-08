import { describe, expect, it } from 'vitest';
import { initializationFailure } from '../server/initializationFailure';

describe('API initialization failures', () => {
  it.each(['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'])('reports %s as a dependency failure', async code => {
    const cause = Object.assign(new Error("Cannot find package 'dotenv'"), { code });
    const response = initializationFailure(new Error('Database initialization failed', { cause }));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body.error.code).toBe('DEPENDENCY_MISSING');
    expect(body.error.message).toContain('npm install --omit=dev --include=optional');
  });
  it('reports file permissions separately from dependency failures', async () => {
    const error = Object.assign(new Error('secret-path'), { code: 'EACCES' });
    const body = await initializationFailure(error).json();
    expect(body.error.code).toBe('DATABASE_FILE_UNAVAILABLE');
    expect(body.error.message).not.toContain('secret-path');
  });
  it('does not invent a database diagnosis or expose unexpected error details', async () => {
    const error = new Error('secret-token');
    Object.assign(error, { cause: error });
    const body = await initializationFailure(error).json();
    expect(body.error.code).toBe('SERVER_INITIALIZATION_FAILED');
    expect(body.error.message).not.toMatch(/数据库|secret-token/);
  });
});
