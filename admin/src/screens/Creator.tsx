import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import useSWR from 'swr';
import type { CreatorCard, HistoryRow, HubPost, Level, ProfileView, RefreshResult } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { followersRange } from '../labels';
import { Avatar, Badge, Crumbs, Empty, handle, Loading, Out, Problem, Table, useAction, useSession, useToast, type Tone } from '../ui';

function ageOf(birth: string): number | null {
  const date = new Date(`${birth}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  if (now.getUTCMonth() < date.getUTCMonth() || (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())) age -= 1;
  return age;
}

function AccountActions({ card, onDone }: { card: CreatorCard; onDone: (next: CreatorCard) => void }) {
  const { t, f } = useI18n();
  const { refresh } = useSession();
  const { busy, run } = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const decide = async (status: 'confirmed' | 'rejected') => {
    const next = await run(
      () => api.post<CreatorCard>(`/creators/${card.id}/account`, { status, note: status === 'rejected' ? note : null }),
      status === 'confirmed' ? t.creator.confirmed : t.creator.rejected,
    );
    if (next) {
      onDone(next);
      setRejecting(false);
      refresh();
    }
  };

  if (!card.joinedAt) return null;
  return (
    <div className="stack stack--tight" style={{ alignItems: 'flex-end' }}>
      <div className="row-gap">
        {card.accountStatus !== 'confirmed' && (
          <button type="button" className="btn btn--green" disabled={busy} onClick={() => void decide('confirmed')}>
            {t.creator.confirm}
          </button>
        )}
        {card.accountStatus !== 'rejected' && !rejecting && (
          <button type="button" className="btn btn--line" disabled={busy} onClick={() => setRejecting(true)}>
            {t.creator.reject}
          </button>
        )}
      </div>
      {rejecting && (
        <div className="stack stack--tight" style={{ width: 'min(420px, 100%)' }}>
          <label htmlFor="reject-note" className="small strong">
            {t.creator.rejectNote}
          </label>
          <textarea id="reject-note" className="textarea" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row-gap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRejecting(false)}>
              {t.common.cancel}
            </button>
            <button type="button" className="btn btn--danger btn--sm" disabled={busy || !note.trim()} onClick={() => void decide('rejected')}>
              {t.creator.rejectSend}
            </button>
          </div>
        </div>
      )}
      {card.accountReviewedAt && <span className="tiny muted">{t.creator.reviewedAt(f.day(card.accountReviewedAt))}</span>}
    </div>
  );
}

function InstagramBlock({ card, profile, onRefreshed }: { card: CreatorCard; profile: ProfileView | null; onRefreshed: () => void }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const { busy, run } = useAction();
  const refreshNow = async () => {
    const result = await run(() => api.post<RefreshResult>(`/creators/${card.id}/refresh`));
    if (!result) return;
    toast(result.state === 'done' ? t.creator.refreshDone : t.creator.refreshPending);
    onRefreshed();
  };
  const profileWord = !profile
    ? ''
    : profile.status === 'private' || profile.isPrivate
      ? t.creator.closed
      : profile.status === 'not_found'
        ? t.creator.notFound
        : profile.status === 'error'
          ? t.creator.providerError
          : t.creator.open;

  return (
    <section className="card pad">
      <div className="head" style={{ alignItems: 'baseline' }}>
        <h2 className="h2">
          {t.creator.igTitle} {profile?.source === 'demo' && <Badge tone="mute">{t.common.demoData}</Badge>}
        </h2>
        <span className="tiny muted">
          {profile ? `${t.creator.updated(f.day(profile.fetchedAt))} ` : ''}
          <button type="button" className="linkbtn tiny" disabled={busy} onClick={() => void refreshNow()}>
            {busy ? t.creator.refreshing : t.creator.refresh}
          </button>
        </span>
      </div>
      {profile ? (
        <>
          <div className="grid" style={{ ['--min' as string]: '130px', gap: 10 }}>
            {[
              [f.num(profile.followers), t.creator.statFollowers],
              [f.num(profile.following), t.creator.statFollowing],
              [f.num(profile.postsCount), t.creator.statPosts],
              [f.num(profile.avgReelViews), t.creator.statAvg],
              [f.pct(profile.engagementRate), t.creator.statEr(12)],
              [profileWord, t.creator.statProfile],
            ].map(([value, label]) => (
              <div key={label} className="tile">
                <div className="tile__value">{value || '—'}</div>
                <div className="tile__label">{label}</div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="muted">{t.creator.noProfile}</div>
      )}
    </section>
  );
}

/** What the creator published for the Hub's tasks: the team checks these, not the whole Instagram feed. */
function HubPosts({ posts }: { posts: HubPost[] }) {
  const { t, f } = useI18n();
  const numbers = (post: HubPost): string => {
    if (post.statedViews !== null) return `${f.num(post.statedViews)} ${t.creator.viewsShort}, ${t.creator.stated}`;
    if (post.views !== null) return `${f.num(post.views)} ${t.creator.viewsShort}`;
    if (post.likes !== null) return `${f.num(post.likes)} ${t.creator.likesShort}`;
    return t.common.noData;
  };
  return (
    <section className="card pad">
      <div className="head" style={{ alignItems: 'baseline' }}>
        <h2 className="h2">{t.creator.hubPosts}</h2>
        <span className="tiny muted">{t.creator.hubPostsHint}</span>
      </div>
      {posts.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 12 }}>
          {posts.map((post) => (
            <div key={post.id} className="stack" style={{ gap: 6, minWidth: 0 }}>
              <Out href={post.url} className="thumb plain">
                <span style={{ height: 200, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {post.thumbUrl ? <img src={post.thumbUrl} alt="" loading="lazy" /> : t.kinds[post.kind]}
                </span>
              </Out>
              <div className="row-gap" style={{ gap: 6 }}>
                <Badge tone="dark">{t.kinds[post.kind]}</Badge>
                {post.status === 'removed' ? <Badge tone="bad">{t.creator.postRemoved}</Badge> : post.status === 'tracking' ? <Badge tone="mute">{t.creator.postMeasuring}</Badge> : null}
              </div>
              <div className="small strong">{numbers(post)}</div>
              <Link to={`/reports/${post.taskId}`} className="tiny ellipsis" title={post.taskTitle}>
                {post.taskTitle}
              </Link>
              <div className="tiny muted">{f.day(post.publishedAt)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">{t.creator.noHubPosts}</div>
      )}
    </section>
  );
}

function historyStatus(t: ReturnType<typeof useI18n>['t'], row: HistoryRow): [string, Tone] {
  if (row.status === 'approved') {
    if (row.measuring === 'removed') return [t.entry.removed, 'bad'];
    if (row.measuring === 'tracking') return [t.entry.measuring, 'mute'];
    return [t.entry.final, 'ok'];
  }
  const tone: Tone = row.status === 'in_review' || row.status === 'draft_review' ? 'warn' : row.status.endsWith('changes') ? 'bad' : 'mute';
  return [t.entry[row.status], tone];
}

function TagsEditor({ card, onSaved }: { card: CreatorCard; onSaved: (next: CreatorCard) => void }) {
  const { t } = useI18n();
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const save = async (tags: string[]) => {
    const next = await run(() => api.put<CreatorCard>(`/creators/${card.id}/tags`, { tags }), t.common.saved);
    if (next) onSaved(next);
  };
  return (
    <div className="stack stack--tight">
      <span className="muted">{t.creator.tags}</span>
      <div className="row-gap" style={{ gap: 6 }}>
        {card.tags.map((tag) => (
          <span key={tag} className="tag">
            {tag}
            <button type="button" aria-label={`${t.common.remove}: ${tag}`} disabled={busy} onClick={() => void save(card.tags.filter((x) => x !== tag))}>
              ×
            </button>
          </span>
        ))}
        {adding ? (
          <form
            className="row-gap"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = value.trim().toLowerCase();
              if (clean) void save([...card.tags, clean]).then(() => setValue(''));
              setAdding(false);
            }}
          >
            <input className="input input--sm" style={{ width: 140, height: 32 }} autoFocus maxLength={30} placeholder={t.creator.tagPlaceholder} value={value} onChange={(e) => setValue(e.target.value)} aria-label={t.creator.tagPlaceholder} />
            <button type="submit" className="btn btn--dark btn--sm" style={{ height: 32 }}>
              {t.common.add}
            </button>
          </form>
        ) : (
          <button type="button" className="tag-add" onClick={() => setAdding(true)} disabled={card.tags.length >= 20}>
            {t.creator.addTag}
          </button>
        )}
      </div>
    </div>
  );
}

export function Creator() {
  const { id } = useParams();
  const { t, f, lang } = useI18n();
  const { me } = useSession();
  const { run } = useAction();
  const { data: card, error, mutate } = useSWR<CreatorCard>(`/creators/${id}`);
  if (!card) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const set = (next: CreatorCard) => void mutate(next, { revalidate: false });
  const ig = card.instagramProfile;
  const statusBadge: [string, Tone] =
    card.accountStatus === 'confirmed' ? [t.creator.accountConfirmed, 'ok'] : card.accountStatus === 'rejected' ? [t.creator.accountRejected, 'bad'] : [t.creator.accountPending, 'warn'];
  const changeLevel = async (value: string) => {
    const next = await run(() => api.put<CreatorCard>(`/creators/${card.id}/level`, { level: value === 'auto' ? null : (value as Level) }), t.common.saved);
    if (next) set(next);
  };
  const band = ig?.followers != null ? followersBand(ig.followers) : null;
  const age = card.details.birthDate ? ageOf(card.details.birthDate) : null;

  return (
    <>
      <Crumbs items={[{ to: '/creators', label: t.creator.crumbs }, { label: card.name }]} />

      <section className="card" style={{ padding: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 }}>
        <Avatar name={card.name} url={card.avatarUrl} size={76} />
        <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div className="row-gap" style={{ gap: 10 }}>
            <h1 className="h1" style={{ fontSize: 26 }}>
              {card.name}
            </h1>
            <Badge tone="dark">{t.levels[card.level]}</Badge>
            <Badge tone={statusBadge[1]}>{statusBadge[0]}</Badge>
            {card.sample && <Badge tone="mute">{t.common.sample}</Badge>}
          </div>
          <div className="ink2">
            {card.instagram && (
              <>
                <Out href={`https://instagram.com/${card.instagram}`}>
                  <strong>{handle(card.instagram)}</strong>
                </Out>{' '}
                {t.creator.lineInstagram}
              </>
            )}
            {card.username && `, ${t.creator.lineTelegram} @${card.username}`}
            {card.city && `, ${t.city(card.city)}`}.{' '}
            {card.joinedAt && t.creator.joined(f.day(card.joinedAt), card.invitedVia === 'link' ? t.creator.viaLink : card.invitedVia === 'list' ? t.creator.viaList : null)}
          </div>
          {ig?.bio && (
            <div className="ink2">
              <strong>{t.creator.bio}</strong> {ig.bio}
            </div>
          )}
          {card.details.birthDate && (
            <div className="ink2">
              <strong>{t.creator.born}</strong> {f.dayYear(card.details.birthDate)}
              {age !== null ? `, ${t.creator.age(age)}` : ''}
            </div>
          )}
          {card.accountNote && <div className="small muted">{card.accountNote}</div>}
        </div>
        <AccountActions card={card} onDone={set} />
      </section>

      <div className="cols">
        <div className="col-main stack">
          <InstagramBlock card={card} profile={ig} onRefreshed={() => void mutate()} />
          <HubPosts posts={card.hubPosts} />

          <Table
            cols="2.2fr 1fr 1fr 1fr 1.1fr"
            min={560}
            title={<h2 className="h2" style={{ padding: '16px 18px 8px' }}>{t.creator.history}</h2>}
            head={[t.creator.colTask, t.creator.colFormat, <div className="num">{t.creator.colViews}</div>, <div className="num">{t.creator.colCoins}</div>, t.creator.colStatus]}
          >
            {card.history.length ? (
              card.history.map((row) => {
                const [label, tone] = historyStatus(t, row);
                return (
                  <div key={row.entryId} className="trow">
                    <div style={{ fontWeight: 600 }}>{row.taskTitle}</div>
                    <div>{row.kinds.map((kind) => t.kinds[kind]).join(', ') || '—'}</div>
                    <div className="num">
                      {row.kinds.length ? (row.views || row.statedViews ? `${f.num(row.views)}${row.statedViews ? `, ${t.creator.stated}` : ''}` : t.common.noData) : '—'}
                    </div>
                    <div className="num strong" style={{ color: row.paid ? 'var(--ink)' : 'var(--muted)' }}>
                      +{f.num(row.coins)}
                    </div>
                    <div>
                      <Badge tone={tone}>{label}</Badge>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty>{t.creator.noHistory}</Empty>
            )}
          </Table>
        </div>

        <div className="col-side stack">
          <section className="card pad">
            <h2 className="h2">{t.creator.segments}</h2>
            <div className="kv">
              <span>{t.creator.city}</span>
              <span>{card.city ? t.city(card.city) : '—'}</span>
            </div>
            <div className="kv">
              <span>{t.creator.audience}</span>
              <span>{band ? followersRange(t, lang, band[0], band[1]) : '—'}</span>
            </div>
            <div className="field">
              <label htmlFor="level" className="muted" style={{ fontWeight: 400 }}>
                {t.creator.level}
              </label>
              <select id="level" className="select select--sm" disabled={me.role !== 'owner'} value={card.levelOverride ?? 'auto'} onChange={(e) => void changeLevel(e.target.value)}>
                <option value="auto">{card.levelOverride ? t.creator.levelByRating : t.creator.levelAuto(t.levels[card.level])}</option>
                {(['member', 'pro', 'partner'] as const).map((level) => (
                  <option key={level} value={level}>
                    {t.creator.levelManual(t.levels[level])}
                  </option>
                ))}
              </select>
              {me.role !== 'owner' && <span className="tiny muted">{t.creator.levelOwnerOnly}</span>}
            </div>
            <TagsEditor card={card} onSaved={set} />
          </section>

          <section className="card pad" style={{ gap: 10 }}>
            <h2 className="h2">{t.creator.inHub}</h2>
            <div className="kv">
              <span>{t.creator.rating}</span>
              <span className="strong">{f.num(card.rating)}</span>
            </div>
            <div className="kv">
              <span>{t.creator.publications}</span>
              <span className="strong">{f.num(card.hub.publications)}</span>
            </div>
            <div className="kv">
              <span>{t.creator.views}</span>
              <span className="strong">{f.num(card.hub.views)}</span>
            </div>
            <div className="kv">
              <span>{t.creator.score}</span>
              <span className="strong">{card.hub.teamScore !== null ? t.creator.scoreValue(String(card.hub.teamScore).replace('.', lang === 'ru' ? ',' : '.')) : '—'}</span>
            </div>
            <div className="kv">
              <span>{t.creator.balance}</span>
              <span className="strong">{f.coins(card.hub.balance)}</span>
            </div>
          </section>

          <section className="card pad" style={{ gap: 10 }}>
            <h2 className="h2">{t.creator.wallet}</h2>
            {card.wallet.length ? (
              card.wallet.slice(0, 6).map((row) => (
                <div key={row.id} className="kv">
                  <span className="ellipsis">
                    {row.title} <span className="tiny">· {f.day(row.createdAt)}</span>
                  </span>
                  <span className="strong" style={{ color: row.amount < 0 ? 'var(--red-dark)' : 'var(--green)' }}>
                    {row.amount > 0 ? '+' : '−'}
                    {f.num(Math.abs(row.amount))}
                  </span>
                </div>
              ))
            ) : (
              <span className="muted">{t.creator.noWallet}</span>
            )}
          </section>

          <section className="card pad" style={{ gap: 10 }}>
            <h2 className="h2">{t.creator.details}</h2>
            <div className="kv">
              <span>{t.creator.tiktok}</span>
              <span>
                {card.tiktok
                  ? `${handle(card.tiktok)}${card.tiktokProfile?.followers != null ? `, ${f.num(card.tiktokProfile.followers)} ${t.creator.followersShort}` : ''}`
                  : <span className="muted">{t.common.notSet}</span>}
              </span>
            </div>
            <Detail label={t.creator.size} value={card.details.size} />
            <Detail label={t.creator.address} value={card.details.address} />
            <Detail label={t.creator.phone} value={card.details.phone} />
            <Detail label={t.creator.payout} value={card.details.payoutDetails} />
          </section>
        </div>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>
        <Link to="/creators">← {t.creator.crumbs}</Link>
      </p>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  const { t } = useI18n();
  return (
    <div className="kv">
      <span>{label}</span>
      {value ? <span>{value}</span> : <span className="muted" style={{ fontWeight: 400 }}>{t.common.notSet}</span>}
    </div>
  );
}

/** The follower band a creator falls in, the way the team talks about it. */
function followersBand(n: number): [number | null, number | null] {
  if (n < 1000) return [null, 1000];
  if (n <= 3000) return [1000, 3000];
  if (n <= 10000) return [3000, 10000];
  return [10000, null];
}
