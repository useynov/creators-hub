import { useState } from 'react';
import useSWR from 'swr';
import type { InviteLinkState, InviteResult, Invitations, InviteState } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Badge, Crumbs, Empty, Loading, Problem, Table, useAction, useToast, type Tone } from '../ui';

const STATE_TONE: Record<InviteState, Tone> = { not_opened: 'mute', started: 'mute', pending: 'warn', confirmed: 'ok', rejected: 'bad' };

/** The link with its secret part hidden until someone asks to see it. */
const masked = (link: string): string => link.replace(/(start=join_)[A-Za-z0-9_-]+/, '$1••••••••');

export function Invite() {
  const { t, f } = useI18n();
  const toast = useToast();
  const { data, error, mutate } = useSWR<Invitations>('/invites');
  const { busy, run } = useAction();
  const [list, setList] = useState('');
  const [tags, setTags] = useState('');
  const [result, setResult] = useState<InviteResult | null>(null);
  const [shown, setShown] = useState(false);

  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;
  const link = data.link;

  const send = async () => {
    const answer = await run(() => api.post<InviteResult>('/invites', { list, tags: tags || null }));
    if (!answer) return;
    setResult(answer);
    const count = (kind: string) => answer.results.filter((r) => r.result === kind).length;
    toast(t.invite.result(count('added'), count('exists'), count('invalid')));
    if (!count('invalid')) {
      setList('');
      setTags('');
    }
    void mutate();
  };
  const linkAction = async (action: 'on' | 'replace' | 'off') => {
    const next = await run(
      () => api.post<InviteLinkState>('/invites/link', { action }),
      action === 'replace' ? t.invite.replaced : action === 'off' ? t.invite.turnedOff : undefined,
    );
    if (next) void mutate({ ...data, link: next }, { revalidate: false });
  };
  const copy = async () => {
    if (!link.link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      toast(t.common.copied);
    } catch {
      setShown(true);
    }
  };
  const invalid = result?.results.filter((r) => r.result === 'invalid').map((r) => r.ref) ?? [];

  return (
    <>
      <Crumbs items={[{ to: '/creators', label: t.creator.crumbs }, { label: t.invite.crumbs }]} />
      <h1 className="h1">{t.invite.title}</h1>

      <div className="cols">
        <section className="card pad pad--20" style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h2 className="h2 h2--big">{t.invite.byList}</h2>
            <div className="small muted">{t.invite.byListHint}</div>
          </div>
          <div className="field">
            <label htmlFor="list">{t.invite.listLabel}</label>
            <textarea id="list" className="textarea" rows={5} placeholder="@username" maxLength={5000} value={list} onChange={(e) => setList(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tags">
              {t.invite.tagsLabel} <span className="opt">{t.common.optional}</span>
            </label>
            <input id="tags" className="input" placeholder={t.invite.tagsPlaceholder} maxLength={300} value={tags} onChange={(e) => setTags(e.target.value)} />
          </div>
          {invalid.length > 0 && <div className="notice">{t.invite.invalidList(invalid.join(', '))}</div>}
          <button type="button" className="btn btn--red" style={{ alignSelf: 'flex-start' }} disabled={busy || !list.trim()} onClick={() => void send()}>
            {t.invite.send}
          </button>
        </section>

        <section className="card pad pad--20" style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row-gap" style={{ gap: 10 }}>
              <h2 className="h2 h2--big">{t.invite.byLink}</h2>
              <Badge tone={link.on ? 'ok' : 'mute'}>{link.on ? t.invite.on : t.invite.off}</Badge>
            </div>
            <div className="small muted">{t.invite.byLinkHint}</div>
          </div>
          {link.on && link.link ? (
            <>
              <div className="row-gap" style={{ flexWrap: 'nowrap' }}>
                <label htmlFor="link" className="sr-only">
                  {t.invite.linkLabel}
                </label>
                <input id="link" className="input" readOnly value={shown ? link.link : masked(link.link)} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn--ghost" onClick={() => setShown(!shown)}>
                  {shown ? t.invite.hide : t.invite.show}
                </button>
                <button type="button" className="btn btn--dark" onClick={() => void copy()}>
                  {t.common.copy}
                </button>
              </div>
              {link.link.startsWith('?') && <div className="tiny muted">{t.invite.noBot}</div>}
              <div className="row-gap">
                <button type="button" className="btn btn--line" disabled={busy} onClick={() => void linkAction('replace')}>
                  {t.invite.replace}
                </button>
                <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void linkAction('off')}>
                  {t.invite.turnOff}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className="btn btn--dark" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => void linkAction('on')}>
              {t.invite.turnOn}
            </button>
          )}
          <div className="notice">
            <strong>{t.invite.remember}</strong> {t.invite.warning}
          </div>
          <div className="small muted">{t.invite.stats(link.joined, link.changedAt ? f.day(link.changedAt) : null)}</div>
        </section>
      </div>

      <Table
        cols="1.6fr 1.2fr 1fr 1fr 1.2fr"
        min={640}
        title={<h2 className="h2" style={{ padding: '16px 18px 8px' }}>{t.invite.recent}</h2>}
        head={[t.invite.colWho, t.invite.colHow, t.invite.colBy, t.invite.colWhen, t.invite.colState]}
      >
        {data.recent.length ? (
          data.recent.map((row) => (
            <div key={row.id} className="trow">
              <div style={{ fontWeight: 600 }}>{row.who}</div>
              <div>{row.via === 'link' ? t.invite.viaLink : t.invite.viaList}</div>
              <div>{row.by ?? ''}</div>
              <div>{f.day(row.createdAt)}</div>
              <div>
                <Badge tone={STATE_TONE[row.state]}>{t.invite.states[row.state]}</Badge>
              </div>
            </div>
          ))
        ) : (
          <Empty>{t.invite.empty}</Empty>
        )}
      </Table>
    </>
  );
}
