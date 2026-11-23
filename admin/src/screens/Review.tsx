import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import type { CheckResult, EntryDetail, LinkChecksView, PublicationView, QueueItem, ReviewFlag, ReviewQueue, ReviewQueues, StoryItem } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n, type Dict } from '../i18n';
import { Avatar, Empty, handle, Head, Loading, Out, Problem, Tabs, useAction, useSession } from '../ui';

const OK_FLAGS: ReviewFlag[] = ['ok', 'story_saved', 'draft'];
const CHECK_ORDER: Array<keyof LinkChecksView> = ['ownAccount', 'afterStart', 'mention', 'hashtag', 'format', 'reachable'];

function checkLines(t: Dict, f: ReturnType<typeof useI18n>['f'], entry: EntryDetail, pub: PublicationView, key: keyof LinkChecksView, result: CheckResult): [string, string] {
  const kind = t.kinds[pub.kind];
  const published = pub.publishedAt ? f.dayTime(pub.publishedAt) : '—';
  const start = entry.task.startsAt ? f.day(entry.task.startsAt) : '';
  switch (key) {
    case 'ownAccount':
      return t.review.check.ownAccount[result](pub.authorHandle ?? entry.creator.instagram ?? '') as [string, string];
    case 'afterStart':
      return t.review.check.afterStart[result](published, start) as [string, string];
    case 'mention':
      return t.review.check.mention[result](entry.task.requiredMention ?? '') as [string, string];
    case 'hashtag':
      return t.review.check.hashtag[result](entry.task.requiredHashtag ?? '') as [string, string];
    case 'format':
      return t.review.check.format[result](kind) as [string, string];
    case 'reachable':
      return t.review.check.reachable[result]() as [string, string];
  }
}

function Publication({ entry, pub }: { entry: EntryDetail; pub: PublicationView }) {
  const { t, f } = useI18n();
  const { me } = useSession();
  const { busy, run } = useAction();
  const [current, setCurrent] = useState(pub);
  const first = current.snapshots.find((s) => s.kind === 'submit' && s.status === 'done');
  const numbers = first ?? { views: current.views, likes: current.likes, comments: current.comments };
  const preview = current.thumbUrl ?? (current.kind === 'story' ? current.screenshotUrl : null);
  const views = current.kind === 'story' ? current.storyViews : numbers.views;

  return (
    <div className="cols" style={{ gap: 20 }}>
      <div className="stack stack--tight" style={{ flex: '0 1 220px' }}>
        <div className="thumb" style={{ height: 380 }}>
          {preview ? <img src={preview} alt="" /> : t.kinds[current.kind]}
        </div>
        <Out href={current.url} className="small strong">
          {/instagram\.com/i.test(current.url) ? t.review.openPost : t.review.openLink}
        </Out>
        {current.storyCopyUrl && (
          <a href={current.storyCopyUrl} target="_blank" rel="noopener noreferrer" className="small strong">
            {t.review.openCopy}
          </a>
        )}
      </div>
      <div className="stack" style={{ flex: '1 1 340px', minWidth: 0 }}>
        <div className="stack stack--tight">
          <h3 className="label">{t.review.checks}</h3>
          {current.checks ? (
            CHECK_ORDER.map((key) => {
              const result = current.checks![key];
              const [title, note] = checkLines(t, f, entry, current, key, result);
              const tone = result === 'pass' ? 'pass' : key === 'ownAccount' && result === 'fail' ? 'block' : result;
              return (
                <div key={key} className={`check check--${tone}`}>
                  <span className="check__mark" aria-hidden="true">
                    {result === 'pass' ? '✓' : '!'}
                  </span>
                  <div className="cell-main">
                    <span>{title}</span>
                    {note && <span className="tiny" style={{ fontWeight: 400 }}>{note}</span>}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="check check--unknown">
              <span className="check__mark">!</span>
              <span>{t.review.checksPending}</span>
            </div>
          )}
        </div>
        <div className="stack stack--tight">
          <h3 className="label">{first ? t.review.numbers : t.review.numbersNow}</h3>
          <div className="grid" style={{ ['--min' as string]: '110px', gap: 8 }}>
            {[
              [views !== null && views !== undefined ? f.num(views) : current.kind === 'post' ? t.review.notVisible : '—', t.review.views],
              [current.kind === 'story' ? '—' : f.num(numbers.likes) || '—', t.review.likes],
              [current.kind === 'story' ? '—' : f.num(numbers.comments) || '—', t.review.comments],
              [f.num(entry.creator.avgReelViews) || '—', t.review.usual],
            ].map(([value, label]) => (
              <div key={label} className="tile tile--small">
                <span className="tile__value">{value}</span>
                <span className="tile__label">{label}</span>
              </div>
            ))}
          </div>
          <div className="small muted">{t.review.nextMeasures(me.settings.metricsHours)}</div>
          <button
            type="button"
            className="linkbtn small"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={async () => {
              const next = await run(() => api.post<PublicationView>(`/review/publications/${current.id}/recheck`), t.review.rechecked);
              if (next) setCurrent(next);
            }}
          >
            {t.review.recheck}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkPanel({ id, onDone }: { id: number; onDone: () => void }) {
  const { t, f } = useI18n();
  const { refresh } = useSession();
  const { busy, run } = useAction();
  const { data: entry, error, mutate } = useSWR<EntryDetail>(`/review/entries/${id}`);
  const [score, setScore] = useState(4);
  const [comment, setComment] = useState('');
  useEffect(() => {
    setComment('');
  }, [id]);
  if (!entry) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const isDraft = entry.status === 'draft_review';
  const confirmed = entry.creator.accountStatus === 'confirmed';
  const after = (ok: unknown) => {
    if (ok === null) return;
    refresh();
    onDone();
  };

  return (
    <section className="card pad pad--20" style={{ flex: '3 1 620px', minWidth: 0, gap: 18 }}>
      <div className="head">
        <div className="who" style={{ gap: 12 }}>
          <Avatar name={entry.creator.name} url={entry.creator.avatarUrl} size={44} />
          <div className="cell-main">
            <Link to={`/creators/${entry.creator.id}`} className="plain" style={{ fontSize: 17 }}>
              {entry.creator.name}
              {entry.creator.instagram ? `, ${handle(entry.creator.instagram)}` : ''}
            </Link>
            <span className="small muted" style={{ fontWeight: 400 }}>
              {entry.task.title}. {[...new Set(entry.publications.map((p) => t.kinds[p.kind]))].join(', ')}
              {entry.publications.length ? '. ' : ''}
              {t.review.sent(f.dayTime(isDraft ? entry.draftSentAt : entry.submittedAt))} {entry.resent && t.review.resent}
            </span>
          </div>
        </div>
        <span className="pill">{t.review.reward(entry.task.reward)}</span>
      </div>

      {!confirmed && !isDraft && (
        <div className="notice">
          {t.review.accountWarn} <Link to={`/creators/${entry.creator.id}`}>{t.review.accountLink}</Link>
        </div>
      )}

      {isDraft ? (
        <div className="stack stack--tight">
          <h3 className="label">{t.review.draftLink}</h3>
          {entry.draftLink ? <Out href={entry.draftLink}>{entry.draftLink}</Out> : <span className="muted">{t.review.draftInBot}</span>}
        </div>
      ) : entry.publications.length ? (
        entry.publications.map((pub) => <Publication key={pub.id} entry={entry} pub={pub} />)
      ) : (
        <div className="stack stack--tight">
          <div className="check check--unknown">
            <span className="check__mark">!</span>
            <span>{t.review.checksPending}</span>
          </div>
          {entry.links.map((link) => (
            <Out key={link} href={link}>
              {link}
            </Out>
          ))}
        </div>
      )}

      <div className="stack" style={{ gap: 4 }}>
        <h3 className="label">{t.review.note}</h3>
        <div>{entry.note ?? <span className="muted">{t.review.noNote}</span>}</div>
      </div>
      {entry.lastComment && (
        <div className="stack" style={{ gap: 4 }}>
          <h3 className="label">{t.review.lastComment}</h3>
          <div className="ink2">{entry.lastComment}</div>
        </div>
      )}

      <div className="row-gap" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 16, gap: 16, alignItems: 'flex-end' }}>
        {isDraft ? (
          <button type="button" className="btn btn--green" disabled={busy} onClick={async () => after(await run(() => api.post(`/review/entries/${id}/approve-draft`), t.review.draftApproved))}>
            {t.review.approveDraft}
          </button>
        ) : (
          <>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ padding: 0, marginBottom: 8, fontWeight: 600 }}>{t.review.score}</legend>
              <div className="row-gap" style={{ gap: 6 }}>
                {[3, 4, 5].map((n) => (
                  <button key={n} type="button" className="score" aria-pressed={score === n} onClick={() => setScore(n)}>
                    {n}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              type="button"
              className="btn btn--green"
              disabled={busy || !confirmed}
              onClick={async () => after(await run(() => api.post(`/review/entries/${id}/approve`, { score }), t.review.approved))}
            >
              {t.review.approve(entry.task.reward)}
            </button>
          </>
        )}
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="fix">{t.review.fixLabel}</label>
            <input id="fix" className="input" maxLength={2000} placeholder={t.review.fixPlaceholder} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn--line"
            disabled={busy || !comment.trim()}
            onClick={async () => after(await run(() => api.post(`/review/entries/${id}/changes`, { comment }), t.review.sentBack))}
          >
            {t.review.sendBack}
          </button>
        </div>
      </div>
    </section>
  );
}

function StoryPanel({ story, onDone }: { story: StoryItem; onDone: () => void }) {
  const { t, f } = useI18n();
  const { refresh } = useSession();
  const { busy, run } = useAction();
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue('');
  }, [story.publicationId]);
  const after = (ok: unknown) => {
    if (ok === null) return;
    refresh();
    onDone();
  };
  const screenshot = story.hasScreenshot ? `/api/admin/media/publications/${story.publicationId}/screenshot` : null;

  return (
    <section className="card pad pad--20" style={{ flex: '3 1 620px', minWidth: 0, gap: 18 }}>
      <div className="head">
        <div className="cell-main">
          <Link to={`/creators/${story.creator.id}`} className="plain" style={{ fontSize: 17 }}>
            {story.creator.name}
            {story.creator.instagram ? `, ${handle(story.creator.instagram)}` : ''}
          </Link>
          <span className="small muted" style={{ fontWeight: 400 }}>
            {story.task.title}. {t.kinds.story}. {t.review.sent(f.dayTime(story.createdAt))}
          </span>
        </div>
        <Out href={story.url} className="small strong">
          {t.review.openPost}
        </Out>
      </div>
      <div className="cols" style={{ gap: 20 }}>
        <div className="stack stack--tight" style={{ flex: '0 1 220px' }}>
          <h3 className="label">{t.review.screenshot}</h3>
          <div className="thumb" style={{ height: 380 }}>
            {screenshot ? <img src={screenshot} alt={t.review.screenshot} /> : t.review.noScreenshot}
          </div>
          {story.hasCopy && (
            <a href={`/api/admin/media/publications/${story.publicationId}/story`} target="_blank" rel="noopener noreferrer" className="small strong">
              {t.review.openCopy}
            </a>
          )}
        </div>
        <div className="stack" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div className="tile">
            <span className="tile__value" style={{ fontSize: 34 }}>
              {story.views !== null ? f.num(story.views) : '—'}
            </span>
            <span className="tile__label">{story.views !== null ? t.review.storyStated : t.review.storyWaiting}</span>
            {story.answeredAt && <span className="tiny muted">{t.review.storyAnswered(f.dayTime(story.answeredAt))}</span>}
          </div>
          {story.views !== null && (
            <button
              type="button"
              className="btn btn--green"
              style={{ alignSelf: 'flex-start' }}
              disabled={busy}
              onClick={async () => after(await run(() => api.post(`/review/stories/${story.publicationId}/confirm`), t.review.storyKept))}
            >
              {t.review.keep}
            </button>
          )}
          <form
            className="row-gap"
            style={{ alignItems: 'flex-end' }}
            onSubmit={async (event) => {
              event.preventDefault();
              const views = Number(value);
              if (!Number.isInteger(views) || views < 0) return;
              after(await run(() => api.post(`/review/stories/${story.publicationId}/views`, { views }), t.review.storyFixed));
            }}
          >
            <div className="field" style={{ width: 200 }}>
              <label htmlFor="views">{t.review.correctLabel}</label>
              <input id="views" className="input" type="number" min={0} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <button type="submit" className="btn btn--line" disabled={busy || value === ''}>
              {t.review.correct}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function QueueList({ items, selected, onSelect }: { items: QueueItem[]; selected: number | null; onSelect: (id: number) => void }) {
  const { t, f } = useI18n();
  return (
    <>
      {items.map((item) => (
        <button key={item.entryId} type="button" className={`queue-item${selected === item.entryId ? ' queue-item--on' : ''}`} onClick={() => onSelect(item.entryId)}>
          <span className="kv" style={{ width: '100%' }}>
            <span className="strong" style={{ color: 'var(--ink)' }}>
              {item.creator.name}
            </span>
            <span className="tiny muted" style={{ fontWeight: 400 }}>
              {f.wait(item.waitingSince)}
            </span>
          </span>
          <span className="small ink2">
            {item.task.title}
            {item.kinds.length ? `, ${item.kinds.map((k) => t.kinds[k].toLowerCase()).join(', ')}` : ''}
          </span>
          <span className={`tiny strong ${OK_FLAGS.includes(item.flag) ? 'flag--ok' : 'flag--warn'}`}>{t.review.flags[item.flag]}</span>
        </button>
      ))}
    </>
  );
}

export function Review() {
  const { t, f } = useI18n();
  const [params, setParams] = useSearchParams();
  const queue = (['works', 'drafts', 'stories'] as ReviewQueue[]).find((q) => q === params.get('queue')) ?? 'works';
  const { data, error, mutate } = useSWR<ReviewQueues>('/review');
  const selectedRaw = Number(params.get('id'));
  if (!data) return error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />;

  const list = queue === 'works' ? data.works : queue === 'drafts' ? data.drafts : data.stories;
  const ids = queue === 'stories' ? data.stories.map((s) => s.publicationId) : (list as QueueItem[]).map((i) => i.entryId);
  const selected = ids.includes(selectedRaw) ? selectedRaw : (ids[0] ?? null);
  const select = (id: number) => setParams({ queue, id: String(id) }, { replace: true });
  const next = () => {
    void mutate();
  };

  return (
    <>
      <Head title={t.review.title}>
        <Tabs
          label={t.review.queues}
          value={queue}
          onChange={(key) => setParams({ queue: key }, { replace: true })}
          items={(['works', 'drafts', 'stories'] as ReviewQueue[]).map((key) => ({ key, label: `${t.review.tabs[key]}, ${data.counts[key]}` }))}
        />
      </Head>
      {!ids.length ? (
        <section className="card">
          <Empty>{t.review.empty[queue]}</Empty>
        </section>
      ) : (
        <div className="cols">
          <section className="card" style={{ flex: '1 1 300px', minWidth: 0, overflow: 'hidden' }}>
            <div className="tiny strong muted" style={{ padding: '14px 16px' }}>
              {t.review.oldestFirst}
            </div>
            {queue === 'stories' ? (
              data.stories.map((story) => (
                <button key={story.publicationId} type="button" className={`queue-item${selected === story.publicationId ? ' queue-item--on' : ''}`} onClick={() => select(story.publicationId)}>
                  <span className="kv" style={{ width: '100%' }}>
                    <span className="strong" style={{ color: 'var(--ink)' }}>
                      {story.creator.name}
                    </span>
                    <span className="tiny muted" style={{ fontWeight: 400 }}>
                      {f.wait(story.answeredAt ?? story.createdAt)}
                    </span>
                  </span>
                  <span className="small ink2">{story.task.title}</span>
                  <span className={`tiny strong ${story.views !== null ? 'flag--ok' : 'flag--warn'}`}>
                    {story.views !== null ? `${f.num(story.views)}, ${t.review.storyStated.toLowerCase()}` : t.review.storyWaitingShort}
                  </span>
                </button>
              ))
            ) : (
              <QueueList items={list as QueueItem[]} selected={selected} onSelect={select} />
            )}
          </section>
          {selected !== null &&
            (queue === 'stories' ? (
              <StoryPanel story={data.stories.find((s) => s.publicationId === selected)!} onDone={next} />
            ) : (
              <WorkPanel key={selected} id={selected} onDone={next} />
            ))}
        </div>
      )}
    </>
  );
}
