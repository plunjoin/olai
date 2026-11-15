import { afterEach, describe, expect, it } from 'vitest';
import { localeFromAcceptLanguage, matchLocale, setLocale, t } from '../i18n';

afterEach(() => setLocale('zh-CN'));

describe('i18n', () => {
  it('matches device languages to a supported locale', () => {
    expect(matchLocale(['zh-TW', 'en'])).toBe('zh-CN');
    expect(matchLocale(['en-GB'])).toBe('en');
    expect(matchLocale(['fr-FR', 'zh-CN'])).toBe('zh-CN');
    expect(matchLocale(['ja-JP'])).toBe('en');
    expect(matchLocale([])).toBe('zh-CN');
  });
  it('honours Accept-Language quality values', () => {
    expect(localeFromAcceptLanguage('en;q=0.5, zh-CN;q=0.9')).toBe('zh-CN');
    expect(localeFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage(null)).toBe('zh-CN');
  });
  it('returns the Chinese source by default and interpolates variables', () => {
    expect(t('取消')).toBe('取消');
    expect(t('共 {n} 件', { n: 3 })).toBe('共 3 件');
  });
  it('falls back to the source when a translation is missing', () => {
    setLocale('en');
    expect(t('这句话没有译文')).toBe('这句话没有译文');
  });
});
