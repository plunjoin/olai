import type { SentMessageInfo } from 'nodemailer';
import { setting } from './settings';

export class MailConfigError extends Error {
  constructor(message = '邮件服务尚未配置，暂时无法发送邮件。请联系管理员。') {
    super(message);
    this.name = 'MailConfigError';
  }
}

export function mailConfigured(): boolean {
  return Boolean(setting('MAIL_HOST').trim() && setting('MAIL_USER').trim() && setting('MAIL_PASS') && setting('MAIL_FROM').trim());
}

export function mailFrom(): string {
  return setting('MAIL_FROM', 'noreply@olai.cc').trim();
}

export function siteOrigin(requestUrl: URL): string {
  return (setting('SITE_ORIGIN') || requestUrl.origin).replace(/\/$/, '');
}

/**
 * nodemailer 只在真正发信时加载：未启用邮件服务的部署不必安装它，
 * 登录、GitHub 授权等接口也不会因为缺少这个可选依赖而整体不可用。
 */
let mailer: Promise<typeof import('nodemailer')> | null = null;

function loadMailer(): Promise<typeof import('nodemailer')> {
  mailer ??= import('nodemailer').catch(error => {
    mailer = null;
    console.error('Loading nodemailer failed:', error);
    throw new MailConfigError('邮件服务依赖缺失，暂时无法发送邮件。请联系管理员。');
  });
  return mailer;
}

async function transport() {
  if (!mailConfigured()) throw new MailConfigError();
  const { createTransport } = await loadMailer();
  const port = Number(setting('MAIL_PORT', '465')) || 465;
  const secure = setting('MAIL_SECURE', 'true') !== 'false';
  return createTransport({
    host: setting('MAIL_HOST').trim(),
    port,
    secure,
    auth: { user: setting('MAIL_USER').trim(), pass: setting('MAIL_PASS') },
  });
}

async function send(options: { to: string; subject: string; text: string; html: string }): Promise<SentMessageInfo> {
  const from = mailFrom();
  return (await transport()).sendMail({ from, replyTo: from, ...options });
}

export async function sendVerificationEmail(to: string, link: string) {
  const subject = '验证你的 Olai 邮箱';
  const text = `欢迎使用 Olai。请打开下面的链接验证邮箱（30 分钟内有效）：\n${link}\n\n如果这不是你本人的操作，请忽略这封邮件。`;
  const html = `<p>欢迎使用 Olai。</p><p>请在 30 分钟内打开这个链接验证邮箱：</p><p><a href="${link}">${link}</a></p><p>如果这不是你本人的操作，请忽略这封邮件。</p>`;
  await send({ to, subject, text, html });
}

export async function sendResetEmail(to: string, link: string) {
  const subject = '重置你的 Olai 密码';
  const text = `我们收到了重置 Olai 密码的请求。请打开下面的链接设置新密码（30 分钟内有效）：\n${link}\n\n如果这不是你本人的操作，请忽略这封邮件，密码不会被更改。`;
  const html = `<p>我们收到了重置 Olai 密码的请求。</p><p>请在 30 分钟内打开这个链接设置新密码：</p><p><a href="${link}">${link}</a></p><p>如果这不是你本人的操作，请忽略这封邮件，密码不会被更改。</p>`;
  await send({ to, subject, text, html });
}
