import { Link } from 'react-router-dom';
import useSWR from 'swr';
import type { HomeView, NewsView } from '../../../server/src/types';
import { Icon } from '../components/Icon';
import { AccountNote, Avatar, Cover, DateBox, Loading, Problem, Progress, Screen, TabBar } from '../components/ui';
import { coins, day, levelName } from '../format';
import { useHub } from '../hub';
import { openExternal, openTelegram } from '../telegram';

const NEXT_PERK = { pro: 'Cash-out opens there.', partner: 'Paid offers open there.' };

/** Landing screen. One photo leads: the next task. Level, event, news and the chat stay quiet. */
export function Home() {
  const { me, settings } = useHub();
  const { data, error, mutate } = useSWR<HomeView>('/api/home');

  return (
    <Screen>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px 0' }}>
        <Link to="/profile" aria-label="Your profile" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, color: 'var(--black)' }}>
          <Avatar src={me.avatarUrl} name={me.firstName} size={40} />
          <span className="label" style={{ maxWidth: '16ch' }}>{settings.brandName}</span>
        </Link>
        <Link to="/wallet" className="chip chip--line chip--lg nums" aria-label={`${coins(me.balance)}, open rewards`}>
          <Icon name="coin" size={18} />
          <span>{coins(me.balance)}</span>
        </Link>
      </header>

      <main className="body body--tabs" style={{ paddingTop: 20, gap: 20 }}>
        <h1 className="display t-display">Hi, {me.firstName}</h1>

        <Link to="/levels" className="stack" style={{ gap: 10, color: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="nums" style={{ fontSize: 15 }}>
              <strong style={{ color: 'var(--black)' }}>{levelName(me.level)}</strong>
              <span className="muted"> · rating {me.rating}</span>
            </span>
            <span className="t-sm muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {me.nextLevel ? `Next: ${levelName(me.nextLevel)}` : 'Top level'}
              <Icon name="right" size={16} />
            </span>
          </div>
          <Progress value={me.progress} />
          <div className="t-sm muted">{me.nextLevel ? NEXT_PERK[me.nextLevel] : 'Paid offers are open for you.'}</div>
        </Link>

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
              <Link to="/offer" className="card card--row card--dark" style={{ gap: 12, padding: '16px 20px' }}>
                <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <div className="t-sm muted">Paid offer, only for you</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{data.offer.campaign}</div>
                </div>
                <Icon name="right" size={20} />
              </Link>
            )}

            <section className="section">
              <div className="section__head">
                <h2 className="eyebrow">Your next task</h2>
                <Link to="/tasks">All tasks{data.newCount ? ` (${data.newCount})` : ''}</Link>
              </div>
              {data.nextTask ? (
                <Link to={`/tasks/${data.nextTask.id}`} className="lead" style={{ minHeight: 360 }}>
                  <Cover src={data.nextTask.coverUrl} alt="" fill eager />
                  <div className="lead__top">
                    <span />
                    <span className="chip chip--white nums">+{coins(data.nextTask.reward)}</span>
                  </div>
                  <div className="lead__body">
                    <div className="t-sm muted">
                      {data.nextTask.date && data.nextTask.place
                        ? `${day(data.nextTask.date)}, ${data.nextTask.place}`
                        : [data.nextTask.format, `until ${day(data.nextTask.deadline)}`].filter(Boolean).join(' · ')}
                    </div>
                    <div className="lead__title">{data.nextTask.title}</div>
                    <div className="lead__foot">
                      <span className="btn btn--white btn--sm">Open task</span>
                    </div>
                  </div>
                </Link>
              ) : (
                <p className="muted" style={{ fontSize: 15 }}>
                  No new tasks right now. The bot will message you when one opens.
                </p>
              )}
            </section>

            {(data.nextEvent || data.news || settings.communityChatUrl) && (
              <section className="section">
                <h2 className="eyebrow">In the Hub</h2>
                <div className="menu">
                  {data.nextEvent && (
                    <Link to={`/events/${data.nextEvent.id}`}>
                      <DateBox date={data.nextEvent.date} monthHint={data.nextEvent.monthHint} />
                      <span className="menu__label">
                        {data.nextEvent.title}
                        <small>{data.nextEvent.going ? 'You are on the list' : 'Open to all members'}</small>
                      </span>
                      <Icon name="right" size={20} color="var(--muted)" />
                    </Link>
                  )}
                  {data.news && <NewsRow news={data.news} />}
                  {settings.communityChatUrl && (
                    <button type="button" onClick={() => openTelegram(settings.communityChatUrl!)}>
                      <span style={{ width: 48, display: 'flex' }}>
                        <Icon name="chat" />
                      </span>
                      <span className="menu__label">
                        Community chat
                        <small>Closed Telegram group for members</small>
                      </span>
                      <Icon name="right" size={20} color="var(--muted)" />
                    </button>
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <TabBar />
    </Screen>
  );
}

/** The latest news as one quiet row. It opens a screen of the Hub (path) or an outside page (url). */
function NewsRow({ news }: { news: NewsView }) {
  const inner = (
    <>
      <span className="menu__label">
        {news.title}
        {news.summary && <small>{news.summary}</small>}
      </span>
      {news.coverUrl ? (
        <Cover src={news.coverUrl} alt="" style={{ width: 64, height: 64, borderRadius: 12 }} />
      ) : (
        <Icon name="right" size={20} color="var(--muted)" />
      )}
    </>
  );
  if (news.path?.startsWith('/')) return <Link to={news.path}>{inner}</Link>;
  if (news.url) {
    return (
      <button type="button" onClick={() => openExternal(news.url!)}>
        {inner}
      </button>
    );
  }
  return <div>{inner}</div>;
}
