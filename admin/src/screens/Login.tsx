import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import type { LoginInfo } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { BrandLogo, errorText, LangSwitch } from '../ui';

/**
 * The page the bot's link opens. The token is exchanged by a POST from this page, not by the
 * GET itself, so link previews and scanners that fetch the address cannot use it up.
 * Afterwards the address is replaced, so the token does not stay in the browser history.
 */
export function Login() {
  const { t } = useI18n();
  const { data: info } = useSWR<LoginInfo>('/auth/info');
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);

  const signIn = async (path: string, body: unknown) => {
    setState('busy');
    try {
      await api.post(path, body);
      window.location.replace('/admin/');
    } catch (problem) {
      setError(problem);
      setState('failed');
    }
  };

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token || started.current) return;
    started.current = true;
    window.history.replaceState(null, '', '/admin/login');
    void signIn('/auth/login', { token });
  }, []);

  const bot = info?.botUsername ? `https://t.me/${info.botUsername}` : null;

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__lang">
          <LangSwitch />
        </div>
        <div className="brand brand--logo" style={{ padding: 0 }}>
          <BrandLogo tone="red" height={34} />
          <div className="brand__name">{t.brand.name}</div>
        </div>
        <h1 className="h1">{t.login.title}</h1>
        {state === 'busy' && <p className="muted">{t.login.signingIn}</p>}
        {state === 'failed' && (
          <div className="notice notice--bad" role="alert">
            <strong>{t.login.failed}.</strong> {errorText(t, error)}
          </div>
        )}
        <p style={{ margin: 0 }}>{t.login.how}</p>
        <p className="muted small" style={{ margin: 0 }}>
          {t.login.rules}
        </p>
        {bot && (
          <a className="btn btn--red" href={bot} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>
            {t.login.openBot}
          </a>
        )}
        {info?.devLogin && (
          <div className="stack stack--tight" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
            <span className="label">{t.login.dev}</span>
            <div className="row-gap">
              {(['owner', 'manager', 'viewer'] as const).map((role) => (
                <button key={role} type="button" className="btn btn--ghost btn--sm" disabled={state === 'busy'} onClick={() => void signIn('/auth/dev', { as: role })}>
                  {t.login.devAs(t.roles[role])}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
