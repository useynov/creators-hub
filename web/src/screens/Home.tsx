import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { HomeView, NewsView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { AccountNote, Avatar, Cover, DateBox, Loading, Problem, Progress, Screen, TabBar } from '../components/ui';
import { coins, day, levelName } from '../format';
import { useHub } from '../hub';
import { openExternal, openTelegram } from '../telegram';

const NEXT_PERK = { pro: 'Cash-out opens there.', partner: 'Paid offers open there.' };

/** Landing screen. Leads with level and belonging: one next task, the next event, news, the chat. */
export function Home() {
  const { me, settings } = useHub();
  const { data, error, mutate } = useSWR<HomeView>('/api/home');

  return (
    <Screen top="red">
      <section
        className="hero"
        style={{ padding: '24px 20px 60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link to="/profile" aria-label="Your profile" style={{ display: 'flex', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.85)' }}>
            <Avatar src={me.avatarUrl} name={me.firstName} size={44} light />
          </Link>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.brandName}</div>
            <h1 className="display" style={{ fontSize: 26, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Hi, {me.firstName}
            </h1>
          </div>
        </div>
        <Link
          to="/wallet"
          className="chip nums"
          style={{ height: 44, padding: '0 14px', gap: 8, borderRadius: 22, background: 'var(--white)', color: 'var(--red-dark)', fontSize: 16, fontWeight: 800 }}
        >
          <Icon name="coin" size={20} stroke={2.2} />
          <span>{coins(me.balance)}</span>
        </Link>
      </section>

      <Link to="/levels" className="card card--col card--float" style={{ margin: '-44px 20px 0', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip chip--ink chip--sm">{levelName(me.level)}</span>
            <span className="nums" style={{ fontSize: 15, fontWeight: 700 }}>
              Rating {me.rating}
            </span>
          </div>
          <Icon name="right" size={20} color="var(--muted)" />
        </div>
        <Progress value={me.progress} />
        <div className="muted" style={{ fontSize: 13 }}>
          {me.nextLevel ? (
            <>
              Next level: <strong style={{ color: 'var(--ink)' }}>{levelName(me.nextLevel)}</strong>. {NEXT_PERK[me.nextLevel]}
            </>
          ) : (
            'You are at the top level. Paid offers are open for you.'
          )}
        </div>
      </Link>

      <main className="body body--tabs" style={{ paddingTop: 18 }}>
        {!data ? (
          error ? (
            <Problem error={error} onRetry={() => void mutate()} />
          ) : (
            <Loading />
          )
        ) : (
          <>
            <AccountNote status={me.accountStatus} note={me.accountNote} confirmTime={settings.accountConfirmTime} />
            {data.offer && (
              <Link to="/offer" className="card card--row card--dark" style={{ gap: 12, padding: '14px 16px' }}>
                <div className="stack" style={{ flex: 1, gap: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    Paid offer, only for you
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{data.offer.campaign}</div>
                </div>
                <Icon name="right" size={20} />
              </Link>
            )}

            <div className="stack" style={{ gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <h2 className="eyebrow">Your next task</h2>
                <Link to="/tasks" style={{ fontSize: 14, fontWeight: 700, padding: '6px 0' }}>
                  All tasks{data.newCount ? ` (${data.newCount})` : ''}
                </Link>
              </div>
              {data.nextTask ? (
                <div className="card card--col" style={{ gap: 12, padding: 10 }}>
                  <Cover src={data.nextTask.coverUrl} alt="" style={{ height: 132, borderRadius: 14 }} />
                  <div className="stack" style={{ gap: 6, padding: '0 6px' }}>
                    <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2 }}>{data.nextTask.title}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {data.nextTask.date && data.nextTask.place
                        ? `${day(data.nextTask.date)}, ${data.nextTask.place}`
                        : [data.nextTask.format, `until ${day(data.nextTask.deadline)}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0 6px 6px' }}>
                    <span className="chip chip--pink nums">+{coins(data.nextTask.reward)}</span>
                    <Link to={`/tasks/${data.nextTask.id}`} className="btn btn--sm">
                      Open task
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="card muted" style={{ fontSize: 15, lineHeight: 1.45 }}>
                  No new tasks right now. The bot will message you when one opens.
                </div>
              )}
            </div>

            {data.nextEvent && (
              <div className="stack" style={{ gap: 8 }}>
                <h2 className="eyebrow">Next event</h2>
                <Link to="/events" className="card card--row" style={{ gap: 14, padding: '12px 14px' }}>
                  <DateBox date={data.nextEvent.date} monthHint={data.nextEvent.monthHint} />
                  <div className="stack" style={{ flex: 1, gap: 2 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{data.nextEvent.title}</div>
                    <div className="muted" style={{ fontSize: 14 }}>
                      {data.nextEvent.going ? 'You are on the list' : 'Open to all members'}
                    </div>
                  </div>
                  <Icon name="right" size={20} color="var(--muted)" />
                </Link>
              </div>
            )}

            {data.news && (
              <div className="stack" style={{ gap: 8 }}>
                <h2 className="eyebrow">News from us</h2>
                <NewsCard news={data.news} />
              </div>
            )}

            {settings.communityChatUrl && (
              <button
                type="button"
                className="card card--row card--dark"
                style={{ gap: 12, padding: '12px 16px' }}
                onClick={() => openTelegram(settings.communityChatUrl!)}
              >
                <Icon name="chat" />
                <div className="stack" style={{ flex: 1, gap: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>Community chat</div>
                  <div style={{ fontSize: 13 }}>Closed Telegram group for members</div>
                </div>
                <Icon name="right" size={20} />
              </button>
            )}
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}

/** The latest news, photo first. It opens a screen of the Hub (path) or an outside page (url). */
function NewsCard({ news }: { news: NewsView }) {
  const inner = (
    <>
      {news.coverUrl && <Cover src={news.coverUrl} alt="" style={{ height: 150, borderRadius: 14 }} />}
      <div className="stack" style={{ gap: 4, padding: news.coverUrl ? '2px 6px 6px' : 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{news.title}</div>
        {news.summary && (
          <div className="muted" style={{ fontSize: 14, lineHeight: 1.4 }}>
            {news.summary}
          </div>
        )}
      </div>
    </>
  );
  const style = { gap: 10, padding: news.coverUrl ? 10 : '14px 16px' };
  if (news.path?.startsWith('/')) {
    return (
      <Link to={news.path} className="card card--col" style={style}>
        {inner}
      </Link>
    );
  }
  if (news.url) {
    return (
      <button type="button" className="card card--col" style={style} onClick={() => openExternal(news.url!)}>
        {inner}
      </button>
    );
  }
  return (
    <div className="card card--col" style={style}>
      {inner}
    </div>
  );
}
