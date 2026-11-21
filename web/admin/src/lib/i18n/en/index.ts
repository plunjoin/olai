import shell from './shell';
import create from './create';
import gallery from './gallery';
import workflow from './workflow';
import admin from './admin';
import errors from './errors';

// 后面的词典覆盖前面的；同一句中文在不同模块应保持同一译法。
const en: Record<string, string> = { ...errors, ...admin, ...workflow, ...gallery, ...create, ...shell };
export default en;
