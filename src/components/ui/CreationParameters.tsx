import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../lib/i18n';

export default function CreationParameters({ children, embedded, host, summary }: { children: ReactNode; embedded: boolean; host?: HTMLElement | null; summary: string }) {
  if (!embedded) return <section className="generation-panel">{children}</section>;
  if (!host) return null;
  return createPortal(<div className="creation-parameters">
    <div className="parameters-heading"><h2>{t('创作参数')}</h2></div>
    <p className="parameters-summary">{summary}</p>
    <div className="parameters-scroll">{children}</div>
  </div>, host);
}
