import { drizzle } from 'drizzle-orm/libsql';
import { initializeDatabase } from '../../../db/runtime.mjs';

export * from '../../../db/schema';
export { eq, and, gt, lt, asc, sql } from 'drizzle-orm';

const client = await initializeDatabase({ development: import.meta.env.DEV }).catch((error: unknown) => {
  console.error('Database initialization failed:', error instanceof Error ? error.message : error);
  throw new Error('数据库初始化失败，请检查文件目录的写入权限或远程数据库连接配置。', { cause: error });
});
export const db = drizzle(client);
