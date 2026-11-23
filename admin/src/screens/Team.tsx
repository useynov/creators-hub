import { useState } from 'react';
import useSWR from 'swr';
import type { TeamRole, TeamRow } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Badge, Head, Loading, Problem, Table, useAction, type Tone } from '../ui';

const ROLES: TeamRole[] = ['owner', 'manager', 'viewer'];
const ROLE_TONE: Record<TeamRole, Tone> = { owner: 'dark', manager: 'mute', viewer: 'line' };
const ACCESS_COLOR = { yes: 'var(--green)', read: 'var(--ink-2)', no: 'var(--red-darker)' } as const;

export function Team() {
  const { t, f } = useI18n();
  const { busy, run } = useAction();
  const { data, error, mutate } = useSWR<TeamRow[]>('/team');
  const [adding, setAdding] = useState(false);
  const [ref, setRef] = useState('');
  const [role, setRole] = useState<TeamRole>('manager');
  const [editing, setEditing] = useState<number | null>(null);
  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const update = (next: TeamRow[] | null) => {
    if (next) void mutate(next, { revalidate: false });
  };
  const add = async () => {
    const next = await run(() => api.post<TeamRow[]>('/team', { ref: ref.trim(), role }), t.team.added);
    if (next) {
      update(next);
      setRef('');
      setAdding(false);
    }
  };

  return (
    <>
      <Head title={t.team.title} sub={t.team.sub}>
        {!adding && (
          <button type="button" className="btn btn--red" onClick={() => setAdding(true)}>
            {t.team.add}
          </button>
        )}
      </Head>

      {adding && (
        <form
          className="card pad pad--20"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <div className="fields" style={{ alignItems: 'flex-end' }}>
            <div className="field">
              <label htmlFor="ref">{t.team.addRef}</label>
              <input id="ref" className="input" maxLength={40} placeholder="@username" value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />
            </div>
            <div className="field" style={{ flex: '0 1 220px' }}>
              <label htmlFor="role">{t.team.addRole}</label>
              <select id="role" className="select" value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.roles[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="row-gap" style={{ flex: '0 0 auto' }}>
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>
                {t.common.cancel}
              </button>
              <button type="submit" className="btn btn--red" disabled={busy || !ref.trim()}>
                {t.common.add}
              </button>
            </div>
          </div>
          <div className="small muted">{t.team.addHint}</div>
        </form>
      )}

      <Table cols="1.6fr 1.2fr 1.2fr 1.4fr 1.6fr" min={760} head={[t.team.colMember, t.team.colTelegram, t.team.colRole, t.team.colSeen, '']}>
        {data.map((row) => (
          <div key={row.telegramId} className="trow">
            <div className="cell-main">
              <span>{row.name}</span>
              {(row.fixed || row.isMe) && <span className="tiny muted" style={{ fontWeight: 400 }}>{[row.fixed && t.team.fixed, row.isMe && t.team.you].filter(Boolean).join(', ')}</span>}
            </div>
            <div>{row.username ? `@${row.username}` : row.telegramId}</div>
            <div>
              {editing === row.telegramId ? (
                <select
                  aria-label={t.team.changeRole}
                  className="select select--sm"
                  value={row.role}
                  disabled={busy}
                  onChange={async (e) => {
                    update(await run(() => api.patch<TeamRow[]>(`/team/${row.telegramId}`, { role: e.target.value }), t.team.changed));
                    setEditing(null);
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t.roles[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <Badge tone={ROLE_TONE[row.role]}>{t.roles[row.role]}</Badge>
              )}
            </div>
            <div className="ink2">{f.ago(row.lastSeenAt)}</div>
            <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
              {!row.fixed && !row.isMe && (
                <>
                  {editing === row.telegramId && (
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      disabled={busy}
                      onClick={async () => {
                        if (!window.confirm(t.team.removeConfirm(row.name))) return;
                        update(await run(() => api.del<TeamRow[]>(`/team/${row.telegramId}`), t.team.removed));
                        setEditing(null);
                      }}
                    >
                      {t.team.removeMember}
                    </button>
                  )}
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(editing === row.telegramId ? null : row.telegramId)}>
                    {editing === row.telegramId ? t.common.cancel : t.common.edit}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </Table>

      <Table
        cols="2fr 1fr 1fr 1fr"
        min={720}
        title={<h2 className="h2" style={{ padding: '16px 18px 8px' }}>{t.team.rights}</h2>}
        head={[t.team.area, t.roles.owner, t.roles.manager, t.roles.viewer]}
      >
        {t.team.matrix.map(([area, ...access]) => (
          <div key={area} className="trow" style={{ padding: '11px 18px' }}>
            <div style={{ fontWeight: 600 }}>{area}</div>
            {access.map((value, index) => (
              <div key={index} style={{ fontWeight: 600, color: ACCESS_COLOR[value] }}>
                {t.team.access[value]}
              </div>
            ))}
          </div>
        ))}
      </Table>

      <div className="small muted">{t.team.footer}</div>
    </>
  );
}
