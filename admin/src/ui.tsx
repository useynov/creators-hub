// Building blocks shared by the screens: headings, badges, tabs, tables, paging, toasts.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminMe } from '../../server/src/admin/types';
import { ApiError } from './api';
import { useI18n, type Dict } from './i18n';

// --- Session ---------------------------------------------------------------------

interface Session {
  me: AdminMe;
  /** Refreshes the counters in the sidebar after a change. */
  refresh: () => void;
}

const SessionContext = createContext<Session | null>(null);
export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

// --- Messages --------------------------------------------------------------------

/** The error in the interface language: our own words for known codes, the server's otherwise. */
export function errorText(t: Dict, error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'offline') return t.errors.offline;
    const known = (t.errors as Record<string, string>)[error.code];
    if (known) return known;
    if (error.status === 403) return t.errors.forbidden;
    if (error.status === 401) return t.errors.unauthorized;
    if (error.status === 404) return t.errors.not_found;
    if (error.message && error.status === 400) return error.message;
  }
  return t.errors.generic;
}

type ToastTone = 'ok' | 'bad';
const ToastContext = createContext<(text: string, tone?: ToastTone) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; tone: ToastTone; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: string, tone: ToastTone = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, tone, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-zone" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Runs an action with a busy flag and shows its error as a toast. Returns null when it failed. */
export function useAction() {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await action();
        if (success) toast(success);
        return result;
      } catch (error) {
        toast(errorText(t, error), 'bad');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t, toast],
  );
  return { busy, run };
}

// --- Layout pieces ---------------------------------------------------------------

export function Crumbs({ items }: { items: Array<{ to?: string; label: string }> }) {
  return (
    <nav className="crumbs" aria-label="breadcrumbs">
      {items.map((item, index) => (
        <span key={index}>
          {index > 0 && ' / '}
          {item.to ? <Link to={item.to}>{item.label}</Link> : item.label}
        </span>
      ))}
    </nav>
  );
}

export function Head({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="head">
      <div className="head__title">
        <h1 className="h1">{title}</h1>
        {sub && <span className="sub">{sub}</span>}
      </div>
      {children && <div className="row-gap">{children}</div>}
    </div>
  );
}

export type Tone = 'ok' | 'warn' | 'bad' | 'mute' | 'dark' | 'line';

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Array<{ key: K; label: ReactNode }>;
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="tabs">
      {items.map((item) => (
        <button key={item.key} type="button" role="tab" aria-selected={item.key === value} className="tab" onClick={() => onChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The Coca-Cola script. The file is served from /brand on the server and is not in git;
 * when it is missing the old round mark takes its place.
 */
export function BrandLogo({ tone, height }: { tone: 'red' | 'white'; height: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="brand__mark" aria-hidden="true">
        CH
      </div>
    );
  }
  return <img src={`/brand/logo-${tone}.svg`} alt="Coca-Cola" height={height} width={Math.round((height * 2000) / 627)} onError={() => setBroken(true)} />;
}

export function Avatar({ name, url, size = 36 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style: CSSProperties = { width: size, height: size, fontSize: Math.max(12, Math.round(size / 2.8)) };
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : (name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <div className="state">{t.common.loading}</div>;
}

export function Problem({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="state state--bad" role="alert">
      <span>{errorText(t, error)}</span>
      {onRetry && (
        <button type="button" className="btn btn--line btn--sm" onClick={onRetry}>
          {t.common.retry}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pager({ page, pageSize, total, shown, onPage, note }: { page: number; pageSize: number; total: number; shown: number; onPage: (page: number) => void; note?: ReactNode }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>{note ?? t.common.shown(shown, total)}</span>
      {pages > 1 && (
        <span className="row-gap">
          <span>{t.common.page(page, pages)}</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            {t.common.prev}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            {t.common.next}
          </button>
        </span>
      )}
    </div>
  );
}

/** A table built from CSS grid rows, as in the designs. Scrolls sideways on a narrow window. */
export function Table({ cols, min, head, children, title, footer }: { cols: string; min: number; head: ReactNode[]; children: ReactNode; title?: ReactNode; footer?: ReactNode }) {
  return (
    <section className="card table">
      <div style={{ minWidth: min, ['--cols' as string]: cols }}>
        {title}
        <div className="trow trow--head" role="row">
          {head.map((cell, index) => (
            <div key={index} role="columnheader">
              {cell}
            </div>
          ))}
        </div>
        {children}
        {footer}
      </div>
    </section>
  );
}

export function Stat({ value, label, note }: { value: ReactNode; label: ReactNode; note?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi__label">{label}</div>
      <div className="kpi__value">{value}</div>
      {note && <div className="kpi__note">{note}</div>}
    </div>
  );
}

export function SortHead<K extends string>({ label, sortKey, sort, dir, onSort, align }: { label: string; sortKey: K; sort: K; dir: 'asc' | 'desc'; onSort: (key: K) => void; align?: 'right' }) {
  const active = sort === sortKey;
  return (
    <button type="button" className={`sorthead${align === 'right' ? ' num' : ''}`} onClick={() => onSort(sortKey)} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {label}
      <span aria-hidden="true">{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
    </button>
  );
}

export const accountTone = (status: string, profile: string | null): Tone =>
  profile === 'private' || status === 'rejected' ? 'bad' : status === 'pending' ? 'warn' : 'ok';

export function handle(value: string | null): string {
  return value ? `@${value}` : '';
}

/** An outside link (Instagram, a draft): opened in a new tab without handing over this page. */
export function Out({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const safe = /^https?:\/\//i.test(href) ? href : undefined;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

export function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang" role="group" aria-label={t.nav.language}>
      {(['ru', 'en'] as const).map((code) => (
        <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
