import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { StoryView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, TopBar } from '../components/ui';
import { dayTime, num } from '../format';
import { useAction, useToast } from '../hub';
import { buzz } from '../telegram';

/** 24 hours after a story: only its author sees the views, so we ask for the number and a screenshot. */
export function StoryViews() {
  const { id = '' } = useParams();
  const { data: story, error, mutate } = useSWR<StoryView>(`/api/stories/${id}`);
  const { mutate: mutateAll } = useSWRConfig();
  const toast = useToast();
  const [views, setViews] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [copy, setCopy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const filled = useRef(false);

  // Our copy of the story is private: fetched with the launch data, never by a public address.
  useEffect(() => {
    if (!story?.copyIsImage) return;
    let url: string | null = null;
    let live = true;
    void api.blobUrl(`/api/stories/${story.id}/copy`).then((next) => {
      url = next;
      if (live) setCopy(next);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [story?.id, story?.copyIsImage]);

  useEffect(() => {
    if (story?.views !== null && story?.views !== undefined && !filled.current) {
      filled.current = true;
      setViews(String(story.views));
    }
  }, [story]);

  const [sendNumber, sending] = useAction(async () => {
    const data = new FormData();
    data.set('views', views.trim());
    if (file) data.set('screenshot', file);
    const next = await api.form<StoryView>(`/api/stories/${id}/views`, data);
    await mutate(next, { revalidate: false });
    void mutateAll(`/api/tasks/${next.taskId}`);
    setEditing(false);
    setFile(null);
    buzz('success');
    toast('Thank you. The number is with the team.');
  });

  const back = story ? `/tasks/${story.taskId}` : '/tasks';
  if (!story) {
    return (
      <Screen>
        <TopBar back={back} backLabel="Back to the task" title="Your story" />
        {error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />}
      </Screen>
    );
  }

  const answered = story.answeredAt !== null && story.views !== null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendNumber();
  };

  const copyCard = (
    <div className="card card--row" style={{ gap: 12, padding: 12, borderRadius: 18 }}>
      <div className={`photo${copy ? '' : ' photo--empty'}`} style={{ width: 48, height: 84, borderRadius: 10 }}>
        {copy ? <img src={copy} alt="Your story" width={48} height={84} decoding="async" /> : <Icon name="image" size={20} stroke={1.6} />}
      </div>
      <div className="stack" style={{ gap: 3, minWidth: 0 }}>
        {story.hasCopy ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700, color: 'var(--green)' }}>
            <Icon name="check" size={16} stroke={3} />
            <span>We saved a copy of your story</span>
          </div>
        ) : (
          <div style={{ fontSize: 14, fontWeight: 700 }}>Your story</div>
        )}
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.4 }}>
          Posted {dayTime(story.postedAt)}.{story.hasCopy ? ' The copy is our proof that it went out.' : ''}
        </div>
      </div>
    </div>
  );

  if (answered && !editing) {
    return (
      <Screen>
        <TopBar back={back} backLabel="Back to the task" title={story.taskTitle} />
        <main className="body" style={{ gap: 16 }}>
          <section className="panel panel--dark">
            <div className="panel__icon">
              <Icon name="check" size={28} stroke={3} />
            </div>
            <h1 className="display nums" style={{ fontSize: 30 }}>
              {num(story.views!)} views
            </h1>
            <p className="lede">
              Thank you. The team sees this number as stated by you{story.hasScreenshot ? ', with your screenshot' : ''}.
            </p>
          </section>
          {copyCard}
          <div className="spacer" />
          <div className="actions">
            <Link to={back} className="btn">
              Back to the task
            </Link>
            {story.editable && (
              <button type="button" className="textlink" onClick={() => setEditing(true)}>
                Correct the number
              </button>
            )}
          </div>
        </main>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar back={back} backLabel="Back to the task" title={story.taskTitle} />
      <form className="body" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="stack" style={{ gap: 8 }}>
          <h1 className="display" style={{ fontSize: 28, lineHeight: 1.15 }}>
            How many people saw your story?
          </h1>
          <p className="muted" style={{ fontSize: 15, lineHeight: 1.4 }}>
            Only you can see this number, so we ask you. It takes a minute.
          </p>
        </div>
        {copyCard}
        <div className="form">
          <div className="field">
            <label htmlFor="views">Story views</label>
            <input
              id="views"
              className="input nums"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="For example, 640"
              style={{ fontSize: 20, fontWeight: 700 }}
              value={views}
              onChange={(event) => setViews(event.target.value.replace(/[^\d\s,]/g, ''))}
            />
          </div>
          <div className="field">
            <span id="shot-label" style={{ fontSize: 15, fontWeight: 700 }}>
              Screenshot of the story statistics <small>(helps the team)</small>
            </span>
            <label className="upload" style={{ position: 'relative' }} aria-labelledby="shot-label">
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <Icon name={file ? 'check' : 'upload'} size={24} color={file ? 'var(--green)' : undefined} />
              <span style={{ overflowWrap: 'anywhere' }}>{file ? file.name : 'Add a screenshot'}</span>
            </label>
          </div>
        </div>
        <div className="hint" style={{ fontSize: 14 }}>
          <div>
            <strong>Where to find it:</strong> open your story or its archive, swipe up, and you will see the number of viewers.
          </div>
        </div>
        <div className="spacer" />
        <button type="submit" className="btn" disabled={sending || !views.trim()}>
          Send the number
        </button>
      </form>
    </Screen>
  );
}
