import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import type { HubStoryView } from '../../../server/src/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Loading, Problem, Screen, hubName, keepBrand } from '../components/ui';
import { ago } from '../format';
import { useHub } from '../hub';

/** How long one story stays up before the next one comes. */
const STORY_MS = 8000;
const TICK_MS = 50;

/**
 * The Hub's stories, full screen, one after another. Tap the right side for the next one, the
 * left side for the one before, hold to pause. Each has one button into the app.
 */
export function HubStory() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const preview = params.has('preview');
  const navigate = useNavigate();
  const { settings } = useHub();
  const { mutate } = useSWRConfig();
  const { data: stories, error, mutate: reload } = useSWR<HubStoryView[]>(preview ? `/api/hub-stories?preview=${encodeURIComponent(id)}` : '/api/hub-stories', {
    // The order must not change under the creator's thumb when a story turns "seen".
    revalidateOnFocus: false,
    revalidateIfStale: false,
  });

  const index = stories ? Math.max(0, stories.findIndex((story) => String(story.id) === id)) : 0;
  const story = stories?.[index];

  // The bar of the story on screen. It carries the story's id, so a bar that has run out can
  // never count for the story that comes after it.
  const [bar, setBar] = useState<{ id: number; value: number }>({ id: 0, value: 0 });
  const progress = story && bar.id === story.id ? bar.value : 0;
  const [paused, setPaused] = useState(false);
  const still = useRef(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const leave = () => {
    void mutate('/api/home');
    navigate('/', { replace: true });
  };
  const go = (to: number) => {
    if (!stories) return;
    if (to < 0) return setBar({ id: story?.id ?? 0, value: 0 });
    if (to >= stories.length) return leave();
    navigate(`/hub/${stories[to]!.id}${preview ? '?preview=1' : ''}`, { replace: true });
  };
  const goRef = useRef(go);
  goRef.current = go;

  // A story that comes on screen is marked as opened.
  const storyId = story?.id;
  useEffect(() => {
    if (storyId && !preview) void api.post(`/api/hub-stories/${storyId}/seen`).catch(() => undefined);
  }, [storyId, preview]);

  // The bar fills by itself; holding a finger on the story stops it. With reduced motion nothing moves on its own.
  useEffect(() => {
    if (!storyId || paused || still.current) return;
    const step = TICK_MS / STORY_MS;
    const timer = window.setInterval(() => setBar((now) => ({ id: storyId, value: Math.min(1, (now.id === storyId ? now.value : 0) + step) })), TICK_MS);
    return () => window.clearInterval(timer);
  }, [storyId, paused]);
  useEffect(() => {
    if (storyId && bar.id === storyId && bar.value >= 1) goRef.current(index + 1);
  }, [bar, storyId, index]);

  if (!stories || !story) {
    return (
      <Screen tone="dark">
        <div className="story">
          <header className="story__head">
            <span style={{ flex: 1 }} />
            <Link to="/" aria-label="Close" className="story__close">
              <Icon name="cross" />
            </Link>
          </header>
          <div style={{ margin: 'auto', padding: 24 }}>
            {error ? <Problem error={error} onRetry={() => void reload()} /> : stories ? <p className="muted">This story is no longer up.</p> : <Loading />}
          </div>
        </div>
      </Screen>
    );
  }

  const hold = {
    onPointerDown: () => setPaused(true),
    onPointerUp: () => setPaused(false),
    onPointerCancel: () => setPaused(false),
    onPointerLeave: () => setPaused(false),
  };

  return (
    <Screen tone={story.tone === 'red' ? 'red' : 'dark'}>
      <article className={`story story--${story.tone}`} aria-roledescription="story" aria-label={`${story.headline}, ${index + 1} of ${stories.length}`}>
        {story.imageUrl && <img className="story__photo" src={story.imageUrl} alt="" decoding="async" />}
        {story.imageUrl && <div className="story__scrim" aria-hidden="true" />}

        <button type="button" className="story__tap story__tap--back" aria-label="Previous story" onClick={() => go(index - 1)} {...hold} />
        <button type="button" className="story__tap story__tap--next" aria-label="Next story" onClick={() => go(index + 1)} {...hold} />

        <div className="story__bars" aria-hidden="true">
          {stories.map((item, position) => (
            <span key={item.id}>
              <i style={{ width: `${position < index ? 100 : position === index ? Math.round((still.current ? 1 : progress) * 100) : 0}%` }} />
            </span>
          ))}
        </div>

        <header className="story__head">
          <span className="story__who" aria-hidden="true">
            {settings.brandInitials}
          </span>
          <b>{hubName(settings.brandName)}</b>
          <span className="story__when">{preview ? 'Preview' : ago(story.publishedAt)}</span>
          <span style={{ flex: 1 }} />
          <button type="button" aria-label="Close stories" className="story__close" onClick={leave}>
            <Icon name="cross" />
          </button>
        </header>

        <div className="story__body">
          {story.kicker && <span className="story__kicker">{story.kicker}</span>}
          <h1 className="display">{keepBrand(story.headline)}</h1>
          {story.body && <p>{story.body}</p>}
          {story.button && (
            <Link to={story.button.path} className={`btn${story.tone === 'red' ? ' btn--white' : ''}`} onClick={() => void mutate('/api/home')}>
              {story.button.label}
            </Link>
          )}
        </div>
      </article>
    </Screen>
  );
}
