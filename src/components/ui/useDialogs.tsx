import { useEffect, useRef, useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import Dialog from './Dialog';
import BrandLogoSvg from '../svg/BrandLogoSvg';
type Request = { title: string; description: string; value?: string; confirmLabel?: string; kind: 'confirm' | 'prompt' };
export default function useDialogs() {
  const [request, setRequest] = useState<Request | null>(null);
  const [value, setValue] = useState('');
  const resolve = useRef<((value: string | boolean | null) => void) | null>(null);
  const finish = (result: string | boolean | null) => { resolve.current?.(result); resolve.current = null; setRequest(null); };
  useEffect(() => () => { resolve.current?.(null); }, []);
  const ask = (next: Request) => new Promise<string | boolean | null>(done => { resolve.current?.(null); resolve.current = done; setValue(next.value || ''); setRequest(next); });
  const confirm = async (title: string, description: string, confirmLabel = '确认删除') => (await ask({ title, description, confirmLabel, kind: 'confirm' })) === true;
  const prompt = async (title: string, description: string, initial: string) => { const result = await ask({ title, description, value: initial, kind: 'prompt' }); return typeof result === 'string' ? result : null; };
  const dialog = request && <Dialog labelledBy="action-title" describedBy="action-description" onClose={() => finish(null)} className="action-dialog">
    <button className="icon-button dialog-close" aria-label="关闭弹窗" onClick={() => finish(null)}><X size={18} /></button>
    <div className={`dialog-emblem ${request.kind}`}><BrandLogoSvg size={58} /></div>
    <h2 id="action-title">{request.title}</h2><p id="action-description">{request.description}</p>
    <form onSubmit={e => { e.preventDefault(); finish(request.kind === 'confirm' ? true : value.trim()); }}>
      {request.kind === 'prompt' && <label className="field-label">会话名称<input data-dialog-focus value={value} maxLength={100} onChange={e => setValue(e.target.value)} onFocus={e => e.currentTarget.select()} /></label>}
      <div className="action-dialog-footer"><button type="button" className="secondary-button" data-dialog-focus={request.kind === 'confirm' ? true : undefined} onClick={() => finish(null)}>取消</button><button type="submit" className={request.confirmLabel === '确认删除' ? 'danger-button' : 'primary-button'} disabled={request.kind === 'prompt' && !value.trim()}>{request.confirmLabel === '确认删除' ? <Trash2 size={16} /> : <Check size={16} />}{request.kind === 'confirm' ? request.confirmLabel : '保存名称'}</button></div>
    </form>
  </Dialog>;
  return { confirm, prompt, dialog };
}
