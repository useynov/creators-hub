import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { TaskView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { dayTime } from '../format';
import { useAction, useHub, useToast } from '../hub';
import { buzz, closeApp, inTelegram, openTelegram } from '../telegram';

/** One link for a reel, a post or a story. With ?draft=1 it sends a draft for approval instead. */
export function Submit() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const draft = params.get('draft') === '1';
  const [retry, setRetry] = useState(params.get('retry') === '1');
  const navigate = useNavigate();
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const { data: task, error, mutate: reload } = useSWR<TaskView>(`/api/tasks/${id}`);

  const [links, setLinks] = useState(['']);
  const [note, setNote] = useState('');
  const prefilled = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);

  // Replacing a link: start from what was sent before.
  useEffect(() => {
    if (!task?.entry || prefilled.current) return;
    prefilled.current = true;
    const before = draft ? (task.entry.draftLink ? [task.entry.draftLink] : []) : task.entry.links;
    if (before.length) setLinks(before);
    if (task.entry.note) setNote(task.entry.note);
  }, [task, draft]);

  const setLink = (index: number, value: string) => setLinks((all) => all.map((link, i) => (i === index ? value : link)));

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error('empty');
      const target = links.findIndex((link) => !link.trim());
      setLink(target >= 0 ? target : 0, text);
      buzz('tap');
    } catch {
      firstInput.current?.focus();
      toast('Press and hold the field, then tap Paste.');
    }
  };

  const [send, sending] = useAction(async () => {
    const next = await api.post<TaskView>(`/api/tasks/${id}/${draft ? 'draft' : 'submit'}`, { links, note });
    await mutate(`/api/tasks/${id}`, next, { revalidate: false });
    void mutate('/api/tasks');
    void mutate('/api/home');
    if (!draft && next.submission?.status === 'blocked') {
      // Stay here and say whose post it is.
      buzz('error');
      setRetry(false);
      return;
    }
    buzz('success');
    navigate(`/tasks/${id}`, { replace: true });
  });

  const [uploadInstead, asking] = useAction(async () => {
    await api.post(`/api/tasks/${id}/draft-upload`);
    if (inTelegram) closeApp();
    else toast('Now send the video to the bot in Telegram.');
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };

  if (!task) {
    return (
      <Screen>
        <TopBar back={`/tasks/${id}`} backLabel="Back to the task" title={draft ? 'Send your draft' : 'Send your work'} />
        {error ? <Problem error={error} onRetry={() => void reload()} /> : <Loading />}
      </Screen>
    );
  }

  if (!draft && !retry && task.submission?.status === 'blocked') {
    return (
      <BlockedView
        task={task}
        onRetry={() => {
          setLinks(['']);
          setRetry(true);
        }}
      />
    );
  }

  const maxLinks = draft ? 1 : task.maxPublications;
  return (
    <Screen>
      <TopBar back={`/tasks/${id}`} backLabel="Back to the task" title={draft ? 'Send your draft' : 'Send your work'} />
      <form className="body" style={{ gap: 18 }} onSubmit={submit} noValidate>
        <div className="card card--row" style={{ justifyContent: 'space-between', gap: 12, padding: '14px 16px' }}>
          <div className="stack" style={{ gap: 2 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{task.title}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Send the link by {dayTime(task.deadline)}
            </div>
          </div>
          <span className="chip chip--pink nums">
            +{task.reward}
          </span>
        </div>

        <div className="form">
          <div className="field">
            <label htmlFor="link-0">{draft ? 'Link to your draft' : 'Link to your reel, post or story'}</label>
            {links.map((link, index) => (
              <div key={index} className="inputrow">
                <input
                  id={`link-${index}`}
                  ref={index === 0 ? firstInput : undefined}
                  className="input"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-label={index ? `Link ${index + 1}` : undefined}
                  placeholder={draft ? 'https://drive.google.com/...' : 'https://www.instagram.com/...'}
                  value={link}
                  onChange={(event) => setLink(index, event.target.value)}
                />
                {index === 0 && (
                  <button type="button" className="btn btn--dark" onClick={() => void paste()}>
                    Paste
                  </button>
                )}
              </div>
            ))}
            {!draft && links.length < maxLinks && (
              <button type="button" className="textlink" style={{ alignSelf: 'flex-start' }} onClick={() => setLinks((all) => [...all, ''])}>
                + Add another link
              </button>
            )}
          </div>
          <div className="field">
            <label htmlFor="note">
              Note for the team <small>(optional)</small>
            </label>
            <textarea
              id="note"
              className="input"
              rows={3}
              maxLength={1000}
              placeholder="Anything we should know"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>

        {draft ? (
          <div className="hint">
            <Icon name="eye" size={22} />
            <div>
              <strong>Do not post yet.</strong> We look at the draft first. Post only after the bot says "Approved".
            </div>
          </div>
        ) : (
          <div className="hint">
            <Icon name="clock" size={22} />
            <div>
              <strong>Posted a story?</strong> Open it, tap Share, then Copy link. Send it the same day: a story link stops
              working after 24 hours.
            </div>
          </div>
        )}

        <div className="spacer" />
        <div className="actions">
          <button type="submit" className="btn" disabled={sending || !links.some((link) => link.trim())}>
            Send for review
          </button>
          {draft && (
            <button type="button" className="textlink" onClick={() => uploadInstead()} disabled={asking}>
              Or send the video file to the bot
            </button>
          )}
        </div>
      </form>
    </Screen>
  );
}

/**
 * A link from someone else's account: refused before it reaches the team. Shows whose post it
 * is, which account is connected, and what we check on every link.
 */
export function BlockedView({ task, onRetry, back = `/tasks/${task.id}` }: { task: TaskView; onRetry?: () => void; back?: string }) {
  const { botLink } = useHub();
  const blocked = task.submission?.blocked ?? [];
  const first = blocked[0];
  const tags = [task.requiredMention && `@${task.requiredMention}`, task.requiredHashtag && `#${task.requiredHashtag}`].filter(Boolean).join(' and ');
  const check = (state: 'fail' | 'todo', text: ReactNode) => (
    <div style={{ color: state === 'fail' ? 'var(--red-darker)' : 'var(--muted)', fontWeight: state === 'fail' ? 700 : 500 }}>
      <Icon name={state === 'fail' ? 'cross' : 'circle'} size={18} stroke={state === 'fail' ? 3 : 2} />
      <span>{text}</span>
    </div>
  );

  return (
    <Screen>
      <TopBar back={back} backLabel={back === '/tasks' ? 'Back to tasks' : 'Back to the task'} title="Send your work" />
      <main className="body" style={{ gap: 18 }}>
        <div className="card card--row" style={{ justifyContent: 'space-between', gap: 12, padding: '14px 16px' }}>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{task.title}</div>
            <div className="muted" style={{ fontSize: 14 }}>
              Send the link by {dayTime(task.deadline)}
            </div>
          </div>
          <span className="chip chip--pink nums">
            +{task.reward}
          </span>
        </div>

        <div className="field">
          <label htmlFor="refused-link">Link to your reel, post or story</label>
          {blocked.map((link, index) => (
            <input
              key={link.url}
              id={index === 0 ? 'refused-link' : undefined}
              className="input input--bad"
              value={link.url}
              readOnly
              aria-invalid="true"
              aria-describedby="link-error"
            />
          ))}
          <div id="link-error" className="hint hint--red" style={{ padding: '12px 14px' }}>
            <Icon name="alert" size={20} />
            <div>
              <strong>This post is from another account.</strong>{' '}
              {first?.author ? `It was published by @${first.author}` : 'It was published by someone else'}
              {first?.expected ? `, and your account in the Hub is @${first.expected}.` : '.'} Send a link to your own post.
            </div>
          </div>
        </div>

        <div className="card card--col" style={{ gap: 10 }}>
          <h2 className="eyebrow">What we check on every link</h2>
          <div className="checks">
            {check('fail', 'Posted from your account')}
            {task.startsAt && check('todo', 'Posted after the task started')}
            {tags && check('todo', `Has ${tags}`)}
          </div>
        </div>

        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          Changed your Instagram handle? <Link to="/profile/instagram">Update it in your profile</Link>, the team will confirm it.
        </p>

        <div className="spacer" />
        <div className="actions">
          {onRetry ? (
            <button type="button" className="btn" onClick={onRetry}>
              Paste another link
            </button>
          ) : (
            <Link to={`/tasks/${task.id}/submit?retry=1`} className="btn">
              Paste another link
            </Link>
          )}
          {botLink && (
            <button type="button" className="textlink" onClick={() => openTelegram(botLink)}>
              Ask the team
            </button>
          )}
        </div>
      </main>
    </Screen>
  );
}
