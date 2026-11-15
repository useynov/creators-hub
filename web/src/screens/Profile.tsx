import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Progress, Screen, TabBar } from '../components/ui';
import { levelName, num } from '../format';
import { useHub } from '../hub';
import { openTelegram } from '../telegram';

/** Level, rating and its three inputs. Details to fill in later, chat, leaderboard, help. */
export function Profile() {
  const { me, settings, botLink } = useHub();
  const chevron = <Icon name="right" size={18} color="var(--muted)" />;
  const handle = me.instagram ? `@${me.instagram}` : me.username ? `@${me.username}` : null;

  return (
    <Screen top="red">
      <section className="hero" style={{ padding: '24px 20px 56px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="avatar" style={{ width: 64, height: 64, background: 'var(--white)', color: 'var(--red-dark)', fontSize: 26 }}>
          {me.firstName.charAt(0)}
        </div>
        <div className="stack" style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <h1 className="display" style={{ fontSize: 24 }}>
            {me.firstName}
          </h1>
          <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[handle, me.city].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span className="chip chip--ink">{levelName(me.level)}</span>
      </section>

      <Link to="/levels" className="card card--col card--float" style={{ margin: '-40px 20px 0', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Rating</div>
          <div className="nums" style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
            {me.rating}
          </div>
        </div>
        <Progress value={me.progress} />
        <div className="grid3 nums">
          <div className="tile">
            <b>{num(me.stats.publications)}</b>
            <span>Publications</span>
          </div>
          <div className="tile">
            <b>{num(me.stats.views)}</b>
            <span>Views</span>
          </div>
          <div className="tile">
            <b>{me.stats.teamScore === null ? '–' : `${me.stats.teamScore} of 5`}</b>
            <span>Team score</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: 'var(--red-dark)' }}>
          <span>{me.nextLevel ? `See what ${levelName(me.nextLevel)} unlocks` : 'See your levels'}</span>
          <Icon name="right" size={18} stroke={2.2} />
        </div>
      </Link>

      <main className="body body--tabs" style={{ paddingTop: 16 }}>
        <div className="menu">
          <Link to="/profile/details" style={{ minHeight: 58 }}>
            <Icon name="user" size={22} />
            <span className="menu__label">
              My details
              <small>Size, address, payout: add when you need them</small>
            </span>
            {chevron}
          </Link>
          <Link to="/leaderboard">
            <Icon name="trophy" size={22} />
            <span className="menu__label">Leaderboard</span>
            {me.rank && <span className="menu__value nums">#{me.rank}</span>}
            {chevron}
          </Link>
          {settings.communityChatUrl && (
            <button type="button" onClick={() => openTelegram(settings.communityChatUrl!)}>
              <Icon name="chat" size={22} />
              <span className="menu__label">Community chat</span>
              {chevron}
            </button>
          )}
          <div>
            <Icon name="globe" size={22} />
            <span className="menu__label">Language</span>
            <span className="menu__value" style={{ fontWeight: 600 }}>
              English
            </span>
          </div>
          {botLink && (
            <button type="button" onClick={() => openTelegram(botLink)}>
              <Icon name="help" size={22} />
              <span className="menu__label">Help: write to the team</span>
              {chevron}
            </button>
          )}
        </div>
      </main>
      <TabBar />
    </Screen>
  );
}
