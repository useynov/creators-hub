import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { StoriesList, StoryAdmin } from '../../../server/src/admin/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Badge, Empty, Head, Loading, Problem, useAction } from '../ui';

const TONE = { live: 'ok', draft: 'mute', ended: 'dark' } as const;

/** The Hub's stories: what is up now, the drafts, and the ones whose last day has passed. */
export function Stories() {
  const { t, f } = useI18n();
  const { busy, run } = useAction();
  const { data, error, mutate } = useSWR<StoriesList>('/stories');

  const setLive = async (story: StoryAdmin, live: boolean) => {
    await run(() => api.post(`/stories/${story.id}/live`, { live }), live ? t.stories.wentUp : t.stories.wentDown);
    void mutate();
  };

  return (
    <>
      <Head title={t.stories.title} sub={t.stories.sub}>
        <Link className="btn btn--red" to="/stories/new">
          {t.stories.add}
        </Link>
      </Head>
      {!data ? (
        error ? <Problem error={error} onRetry={() => void mutate()} /> : <Loading />
      ) : data.stories.length ? (
        <>
          <div className="shopgrid">
            {data.stories.map((story) => (
              <article key={story.id} className={`card storycard${story.state === 'live' ? '' : ' storycard--off'}`}>
                <Link to={`/stories/${story.id}`} className={`storycard__face storycard__face--${story.tone}`} aria-label={`${t.stories.edit}: ${story.headline}`}>
                  {story.imageUrl && <img src={story.imageUrl} alt="" />}
                  <span className="storycard__words">
                    {story.kicker && <small>{story.kicker}</small>}
                    <b>{story.headline}</b>
                  </span>
                </Link>
                <div className="shopcard__body">
                  <div className="row-gap" style={{ gap: 8 }}>
                    <Badge tone={TONE[story.state]}>{t.stories.states[story.state]}</Badge>
                    <span className="strong">{story.label}</span>
                  </div>
                  <div className="small muted">
                    {story.endsOn ? t.stories.until(f.day(story.endsOn)) : t.stories.untilHidden}
                    {' · '}
                    {t.stories.seenBy(story.seenBy)}
                  </div>
                  <div className="row-gap shopcard__actions">
                    <Link className="btn btn--line btn--sm" to={`/stories/${story.id}`}>
                      {t.stories.edit}
                    </Link>
                    {story.state === 'live' ? (
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void setLive(story, false)}>
                        {t.stories.takeDown}
                      </button>
                    ) : (
                      story.state === 'draft' && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void setLive(story, true)}>
                          {t.stories.putUp}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="small muted">{t.stories.footer}</div>
        </>
      ) : (
        <section className="card">
          <Empty>{t.stories.empty}</Empty>
        </section>
      )}
    </>
  );
}
