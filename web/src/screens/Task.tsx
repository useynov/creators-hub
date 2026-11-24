import { Link, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { useEffect, type ReactNode } from 'react';
import type { PublicationView, TaskView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { AccountNote, Brief as DetailedBrief, Cover, Loading, Problem, Screen, TopBar } from '../components/ui';
import { coins, day, dayLong, dayTime, num, shortLink } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz, closeApp, inTelegram, openTelegram } from '../telegram';
import { BlockedView } from './Submit';

/**
 * One address per task. What the creator sees depends on where their work stands:
 * the brief, the review status, the team's comment, or the approval.
 */
export function Task() {
  const { id = '' } = useParams();
  const { data: task, error, mutate } = useSWR<TaskView>(`/api/tasks/${id}`);

  if (!task) {
    return (
      <Screen>
        <TopBar back="/tasks" backLabel="Back to tasks" title="Task" />
        {error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />}
      </Screen>
    );
  }

  // A send whose links are being read, or a link from another account: say so before anything else.
  if (task.submission?.status === 'checking') return <Checking task={task} onDone={() => void mutate()} />;
  if (task.submission?.status === 'blocked') return <BlockedView task={task} back="/tasks" />;

  switch (task.entry?.status) {
    case 'approved':
      return <Approved task={task} />;
    case 'in_review':
    case 'draft_review':
      return <InReview task={task} />;
    case 'needs_changes':
    case 'draft_changes':
      return <NeedsChanges task={task} />;
    default:
      return task.reviewMode === 'draft_first' ? <DraftBrief task={task} /> : <Brief task={task} />;
  }
}

const reviewLine = (reviewTime: string | null): string =>
  reviewTime ? `The team usually answers within ${reviewTime}.` : 'The team will answer soon.';

// --- 07 Task detail: post first, the team checks after -----------------------

function Brief({ task }: { task: TaskView }) {
  const { mutate } = useSWRConfig();
  const toast = useToast();
  const joined = Boolean(task.entry);

  const [join, joining] = useAction(async () => {
    const next = await api.post<TaskView>(`/api/tasks/${task.id}/join`);
    await mutate(`/api/tasks/${task.id}`, next, { revalidate: false });
    void mutate('/api/tasks');
    void mutate('/api/home');
    buzz('success');
    toast('You are in. The team knows you are coming.');
  });

  const { me, settings } = useHub();
  return (
    <Screen>
      <TopBar back="/tasks" backLabel="Back to tasks" title="Task" />
      <main className="body" style={{ paddingTop: 0 }}>
        <Cover src={task.coverUrl} alt={task.title} style={{ height: 200, borderRadius: 20 }} eager />
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display" style={{ fontSize: 26, lineHeight: 1.15 }}>
            {task.title}
          </h1>
          <div className="pills">
            <span className="chip chip--red nums">+{coins(task.reward)}</span>
            <span className="chip chip--white">Post first, we check after</span>
          </div>
        </div>

        <dl className="rows" style={{ margin: 0 }}>
          {task.date && (
            <div className="row">
              <dt>When</dt>
              <dd style={{ margin: 0 }}>{dayLong(task.date)}</dd>
            </div>
          )}
          {task.place && (
            <div className="row">
              <dt>Where</dt>
              <dd style={{ margin: 0 }}>{task.place}</dd>
            </div>
          )}
          {task.format && (
            <div className="row">
              <dt>Format</dt>
              <dd style={{ margin: 0 }}>{task.format}</dd>
            </div>
          )}
          <div className="row">
            <dt>Send the link by</dt>
            <dd style={{ margin: 0 }}>{dayTime(task.deadline)}</dd>
          </div>
        </dl>

        <AccountNote status={me.accountStatus} note={me.accountNote} confirmTime={settings.accountConfirmTime} />

        {(task.steps.length > 0 || task.summary) && (
          <div className="stack" style={{ gap: 8 }}>
            <h2 className="eyebrow">What to do</h2>
            {task.steps.length ? (
              <ol className="stack" style={{ paddingLeft: 22, gap: 6, fontSize: 15, lineHeight: 1.4 }}>
                {task.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : (
              <p style={{ fontSize: 15, lineHeight: 1.45 }}>{task.summary}</p>
            )}
          </div>
        )}

        {task.viewsBonus && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>
            <Icon name="trophy" size={18} />
            <span>Bonus for the most views on this task</span>
          </div>
        )}

        {task.brief && <DetailedBrief text={task.brief} />}

        <div className="spacer" />
        {task.closed ? (
          <p className="empty" style={{ padding: 12 }}>
            The deadline for this task has passed.
          </p>
        ) : task.locked ? (
          <button type="button" className="btn" disabled>
            Locked
          </button>
        ) : !joined && task.full ? (
          <p className="empty" style={{ padding: 12 }}>
            All places on this task are taken.
          </p>
        ) : joined ? (
          <div className="actions">
            <Link to={`/tasks/${task.id}/submit`} className="btn">
              Send the link
            </Link>
            <div className="textlink" style={{ color: 'var(--green)', gap: 6 }}>
              <Icon name="check" size={18} stroke={2.4} />
              <span>You are in</span>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn" onClick={() => join()} disabled={joining}>
              I'm in
            </button>
            <Link to={`/tasks/${task.id}/submit`} className="textlink">
              Already posted? Send the link
            </Link>
          </div>
        )}
      </main>
    </Screen>
  );
}

// --- 12 Task with draft approval --------------------------------------------

function DraftBrief({ task }: { task: TaskView }) {
  const { me, settings } = useHub();
  const toast = useToast();
  const draftApproved = task.entry?.status === 'draft_approved';
  const current = draftApproved ? 3 : 1;

  const steps = [
    { title: 'Send us your draft', text: 'Upload the video before you post it' },
    { title: 'We approve it or ask for a fix', text: settings.reviewTime ? `Usually within ${settings.reviewTime}` : 'The bot will message you' },
    { title: 'You post it', text: 'Only after the bot says "Approved"' },
    { title: 'Send the link, get your coins', text: `+${coins(task.reward)} land in your wallet` },
  ];

  const [upload, asking] = useAction(async () => {
    await api.post(`/api/tasks/${task.id}/draft-upload`);
    if (inTelegram) closeApp();
    else toast('Now send the video to the bot in Telegram.');
  });

  return (
    <Screen>
      <TopBar back="/tasks" backLabel="Back to tasks" title="Task" />
      <main className="body" style={{ gap: 16, paddingTop: 0 }}>
        <Cover src={task.coverUrl} alt={task.title} style={{ height: 180, borderRadius: 20 }} eager />
        <div className="stack" style={{ gap: 10 }}>
          <h1 className="display" style={{ fontSize: 26, lineHeight: 1.15 }}>
            {task.title}
          </h1>
          <div className="pills">
            <span className="chip chip--red nums">+{coins(task.reward)}</span>
            <span className="chip chip--amber">Draft first, then post</span>
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.45, color: 'var(--ink-2)' }}>
            {[task.summary, `Post by ${day(task.deadline)}.`].filter(Boolean).join(' ')}
          </p>
        </div>
        <AccountNote status={me.accountStatus} note={me.accountNote} confirmTime={settings.accountConfirmTime} />

        <div className="card steps">
          <h2 className="eyebrow">Four steps</h2>
          {steps.map((step, index) => {
            const number = index + 1;
            const state = number < current ? 'done' : number === current ? 'now' : 'todo';
            return (
              <div key={step.title} className="step" data-state={state}>
                <div className="step__n">{state === 'done' ? <Icon name="check" size={16} stroke={3} /> : number}</div>
                <div className="step__text">
                  {step.title}
                  <small>{step.text}</small>
                </div>
              </div>
            );
          })}
        </div>

        {task.brief && <DetailedBrief text={task.brief} />}

        <div className="spacer" />
        {task.closed ? (
          <p className="empty" style={{ padding: 12 }}>
            The deadline for this task has passed.
          </p>
        ) : task.locked ? (
          <button type="button" className="btn" disabled>
            Locked
          </button>
        ) : !task.entry && task.full ? (
          <p className="empty" style={{ padding: 12 }}>
            All places on this task are taken.
          </p>
        ) : draftApproved ? (
          <div className="actions">
            <Link to={`/tasks/${task.id}/submit`} className="btn">
              Send the link
            </Link>
            <div className="textlink" style={{ color: 'var(--green)', gap: 6 }}>
              <Icon name="check" size={18} stroke={2.4} />
              <span>Your draft is approved: post it</span>
            </div>
          </div>
        ) : (
          <div className="actions">
            <button type="button" className="btn" onClick={() => upload()} disabled={asking}>
              <Icon name="upload" size={22} stroke={2.2} />
              <span>Upload draft</span>
            </button>
            <Link to={`/tasks/${task.id}/submit?draft=1`} className="textlink">
              Or paste a link to the draft
            </Link>
          </div>
        )}
      </main>
    </Screen>
  );
}

// --- 09 Status: in review ---------------------------------------------------

type StepState = 'done' | 'now' | 'todo';

function InReview({ task }: { task: TaskView }) {
  const { settings } = useHub();
  const entry = task.entry!;
  const draft = entry.status === 'draft_review';
  const draftFirst = task.reviewMode === 'draft_first';

  const rows: Array<{ label: string; when: string; state: StepState }> = [{ label: 'You joined', when: day(entry.joinedAt), state: 'done' }];
  if (draft) {
    rows.push(
      { label: 'Draft sent', when: entry.draftSentAt ? dayTime(entry.draftSentAt) : '', state: 'done' },
      { label: 'Team review', when: 'Now', state: 'now' },
      { label: 'Post it and send the link', when: '', state: 'todo' },
    );
  } else {
    if (draftFirst) rows.push({ label: 'Draft approved', when: entry.draftApprovedAt ? day(entry.draftApprovedAt) : '', state: 'done' });
    rows.push(
      { label: 'Link sent', when: entry.submittedAt ? dayTime(entry.submittedAt) : '', state: 'done' },
      { label: 'Team review', when: 'Now', state: 'now' },
    );
  }
  rows.push({ label: 'Coins and rating', when: `+${coins(task.reward)}`, state: 'todo' });

  const sent = draft ? entry.draftLink : entry.links[0];
  const more = !draft && entry.links.length > 1 ? ` +${entry.links.length - 1} more` : '';

  return (
    <Screen>
      <TopBar back="/tasks" backLabel="Back to tasks" title={task.title} />
      <main className="body" style={{ gap: 18 }}>
        <section className="panel panel--dark">
          <div className="panel__icon">
            <Icon name="clock" size={28} />
          </div>
          <h1 className="display" style={{ fontSize: 30 }}>
            {draft ? 'Draft in review' : 'In review'}
          </h1>
          <p className="lede">
            We got your {draft ? 'draft' : 'link'}. {reviewLine(settings.reviewTime)} The bot will message you.
            {draft ? ' Do not post it yet.' : ''}
          </p>
        </section>

        <div className="card timeline">
          {rows.map((row) => (
            <div key={row.label} className="timeline__row" data-state={row.state}>
              <span className={`dot dot--${row.state}`}>{row.state === 'done' && <Icon name="check" size={16} stroke={3} />}</span>
              <span>{row.label}</span>
              <span>{row.when}</span>
            </div>
          ))}
        </div>

        <StoryAsk publications={task.publications} />

        {draft || !task.publications.length ? (
          <div className="card card--row" style={{ gap: 12, padding: '14px 16px' }}>
            <Icon name="link" size={22} color="var(--muted)" />
            <div style={{ flex: 1, minWidth: 0, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {sent ? shortLink(sent) + more : 'Sent to the bot as a file'}
            </div>
            {!task.closed && (
              <Link to={`/tasks/${task.id}/submit${draft ? '?draft=1' : ''}`} className="textlink" style={{ fontSize: 14 }}>
                Replace
              </Link>
            )}
          </div>
        ) : (
          <Publications task={task} replace={!task.closed} />
        )}

        <div className="spacer" />
        <Link to="/tasks" className="btn btn--outline">
          Back to tasks
        </Link>
      </main>
    </Screen>
  );
}

// --- 10 Status: needs changes -----------------------------------------------

function NeedsChanges({ task }: { task: TaskView }) {
  const { settings, botLink } = useHub();
  const entry = task.entry!;
  const draft = entry.status === 'draft_changes';

  return (
    <Screen>
      <TopBar back="/tasks" backLabel="Back to tasks" title={task.title} />
      <main className="body" style={{ gap: 18 }}>
        <section className="panel panel--amber">
          <div className="panel__icon">
            <Icon name="alert" size={28} />
          </div>
          <h1 className="display" style={{ fontSize: 30 }}>
            Needs changes
          </h1>
          <p className="lede">Almost there. Fix one thing and send it again. Your coins are waiting.</p>
        </section>

        <div className="card card--col" style={{ gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="avatar" style={{ width: 36, height: 36, background: 'var(--red)', color: 'var(--white)', fontSize: 12 }}>
              {settings.brandInitials}
            </div>
            <div className="stack">
              <div style={{ fontSize: 14, fontWeight: 700 }}>Comment from the team</div>
              {entry.commentAt && (
                <div className="muted" style={{ fontSize: 13 }}>
                  {dayTime(entry.commentAt)}
                </div>
              )}
            </div>
          </div>
          <p style={{ fontSize: 16, lineHeight: 1.45, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{entry.comment}</p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '0 4px', fontSize: 14, lineHeight: 1.45, color: 'var(--ink-2)' }}>
          <Icon name="refresh" size={20} />
          <div>
            You can fix and resend <strong style={{ color: 'var(--ink)' }}>as many times as you need</strong> until{' '}
            {dayTime(task.deadline)}.
          </div>
        </div>

        <div className="spacer" />
        <div className="actions">
          <Link to={`/tasks/${task.id}/submit${draft ? '?draft=1' : ''}`} className="btn" aria-disabled={task.closed}>
            Fix and resend
          </Link>
          {botLink && (
            <button type="button" className="textlink" onClick={() => openTelegram(botLink)}>
              Ask the team a question
            </button>
          )}
        </div>
      </main>
    </Screen>
  );
}

// --- 11 Status: approved ----------------------------------------------------

function Approved({ task }: { task: TaskView }) {
  const { me } = useHub();
  const entry = task.entry!;
  const reward = entry.reward ?? task.reward;

  return (
    <Screen top="red">
      <section className="hero hero--round" style={{ padding: '56px 24px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
        <div className="avatar" style={{ width: 64, height: 64, background: 'var(--white)', color: 'var(--red-dark)' }}>
          <Icon name="check" size={34} stroke={3} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Approved</div>
        <h1 className="display nums" style={{ fontSize: 64, lineHeight: 1 }}>
          +{coins(reward)}
        </h1>
        <div style={{ fontSize: 16, lineHeight: 1.4, fontWeight: 500 }}>{task.title}</div>
      </section>

      <main className="body" style={{ paddingTop: 20 }}>
        <div className="grid2">
          <div className="card card--col" style={{ gap: 4 }}>
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              Your balance
            </div>
            <div className="nums" style={{ fontSize: 26, fontWeight: 800 }}>
              {coins(me.balance)}
            </div>
          </div>
          <div className="card card--col" style={{ gap: 4 }}>
            <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              Your rating
            </div>
            <div className="nums" style={{ fontSize: 26, fontWeight: 800 }}>
              {me.rating}{' '}
              {entry.ratingDelta ? (
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--green)' }}>+{entry.ratingDelta}</span>
              ) : null}
            </div>
          </div>
        </div>

        <StoryAsk publications={task.publications} />
        {task.publications.length > 0 && <Publications task={task} replace={false} />}

        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Icon name="trophy" color="var(--red-dark)" />
          <div className="stack" style={{ gap: 4 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>The views still count</div>
            <div className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              Every view on this post adds to your rating and to your place on the monthly leaderboard.
            </div>
          </div>
        </div>

        <div className="spacer" />
        <div className="actions actions--gap">
          <Link to="/wallet" className="btn">
            See my wallet
          </Link>
          <Link to="/tasks" className="btn btn--outline">
            More tasks
          </Link>
        </div>
      </main>
    </Screen>
  );
}

// --- Checking the link ----------------------------------------------------------

/** The links are being read. Asks again every two seconds until the check is done. */
function Checking({ task, onDone }: { task: TaskView; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setInterval(onDone, 2000);
    return () => window.clearInterval(timer);
  }, [onDone]);
  const links = task.submission?.links ?? [];
  return (
    <Screen>
      <TopBar back="/tasks" backLabel="Back to tasks" title={task.title} />
      <main className="body" style={{ gap: 18 }}>
        <section className="panel panel--dark" role="status">
          <div className="panel__icon">
            <div className="spinner" style={{ width: 26, height: 26 }} />
          </div>
          <h1 className="display" style={{ fontSize: 30 }}>
            Checking your link
          </h1>
          <p className="lede">
            We look at the post on Instagram: that it is yours and that it opens. It usually takes under a minute. You can leave
            this screen.
          </p>
        </section>
        <div className="card card--col" style={{ gap: 10, padding: '14px 16px' }}>
          {links.map((link) => (
            <div key={link} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, minWidth: 0 }}>
              <Icon name="link" size={20} color="var(--muted)" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLink(link)}</span>
            </div>
          ))}
        </div>
        <div className="spacer" />
        <Link to="/tasks" className="btn btn--outline">
          Back to tasks
        </Link>
      </main>
    </Screen>
  );
}

// --- Publications and their numbers ------------------------------------------------

const KIND: Record<PublicationView['kind'], string> = {
  reel: 'Reel',
  post: 'Post',
  story: 'Story',
  tiktok: 'TikTok',
  unknown: 'Link',
};

function numbersOf(publication: PublicationView): ReactNode {
  if (publication.status === 'removed') return <span style={{ color: 'var(--amber)', fontWeight: 700 }}>No longer on Instagram</span>;
  const parts = [
    publication.views !== null ? `${num(publication.views)} views${publication.viewsSource === 'creator' ? ' (from you)' : ''}` : null,
    publication.likes !== null ? `${num(publication.likes)} likes` : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return publication.kind === 'story' ? 'Views: you send them after 24 hours' : 'Numbers come in over the next days';
}

/** Each link with its numbers so far. Measured at sending, after 24 hours, 7 days and 14 days. */
function Publications({ task, replace }: { task: TaskView; replace: boolean }) {
  return (
    <div className="card card--col" style={{ gap: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h2 className="eyebrow">Your {task.publications.length > 1 ? 'publications' : 'publication'}</h2>
        {replace && (
          <Link to={`/tasks/${task.id}/submit`} className="textlink" style={{ fontSize: 14, minHeight: 0 }}>
            Replace
          </Link>
        )}
      </div>
      {task.publications.map((publication) => (
        <div key={publication.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span className="chip chip--sm" style={{ background: 'var(--bg)', color: 'var(--ink-2)' }}>
            {KIND[publication.kind]}
          </span>
          <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLink(publication.url)}</div>
            <div className="muted nums" style={{ fontSize: 13 }}>
              {numbersOf(publication)}
            </div>
          </div>
        </div>
      ))}
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
        We count the numbers four times: when you send the link, after 24 hours, 7 days and 14 days.
      </div>
    </div>
  );
}

/** A story whose views we still need: one clear button to the number screen. */
function StoryAsk({ publications }: { publications: PublicationView[] }) {
  const open = publications.find((publication) => publication.storyViewsOpen && publication.viewsSource !== 'creator');
  if (!open) return null;
  return (
    <Link to={`/stories/${open.id}`} className="card card--row" style={{ gap: 12, padding: '14px 16px', background: 'var(--amber-bg)', color: 'var(--amber-ink)' }}>
      <Icon name="eye" size={22} />
      <div className="stack" style={{ flex: 1, gap: 2 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>How many people saw your story?</div>
        <div style={{ fontSize: 13 }}>Send us the number, it takes a minute.</div>
      </div>
      <Icon name="right" size={20} />
    </Link>
  );
}
