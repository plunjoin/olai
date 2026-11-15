import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en';

// 以中文原文作为 key 的翻译体系里，漏翻不会报错、只会悄悄回落到中文。
// 这里扫描源码中的 t('…') 字面量，保证每个 key 都有英文译文，且译文里不残留中文。
const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'i18n' ? [] : sourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [full];
  });
}

function literalKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of sourceFiles(ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([^'\\\n]*)'/g)) {
      if (!keys.has(match[1])) keys.set(match[1], path.relative(ROOT, file));
    }
  }
  return keys;
}

describe('English dictionary', () => {
  it('translates every literal t() key in the source', () => {
    const missing = [...literalKeys()].filter(([key]) => !(key in en)).map(([key, file]) => `${key} — ${file}`);
    expect(missing).toEqual([]);
  });

  it('does not leave Chinese text in English values', () => {
    const untranslated = Object.entries(en).filter(([, value]) => /[一-鿿]/.test(value));
    expect(untranslated).toEqual([]);
  });

  it('never invents placeholders that the source does not provide', () => {
    // 译文可以省略占位符（例如英文语法不需要 count），但不能引用不存在的变量。
    const mismatched = Object.entries(en).filter(([key, value]) => {
      const names = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]));
      const source = names(key);
      return [...names(value)].some(name => !source.has(name));
    });
    expect(mismatched).toEqual([]);
  });
});
