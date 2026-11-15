import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Screen } from '../components/ui';
import { useHub } from '../hub';

const BENEFITS: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'calendar', title: 'Our events, any time', text: 'You are on the guest list by default' },
  { icon: 'gift', title: 'Free product and merch', text: 'Earn coins, pick what you like' },
  { icon: 'star', title: 'Our news first', text: 'Before anyone outside the Hub' },
];
const LOOP = ['Take a task', 'Post and send the link', 'Earn coins, level up'];

/** First open of the mini app, shown once: three benefits, the loop, one button. */
export function Benefits() {
  const { settings } = useHub();
  return (
    <Screen top="red">
      <section className="hero hero--round stack" style={{ padding: '40px 24px 32px', gap: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {settings.brandName}
        </div>
        <h1 className="display" style={{ fontSize: 40, lineHeight: 1.05 }}>
          Welcome to the family
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.4, fontWeight: 500 }}>
          A closed community of creators. You are in by invitation.
        </p>
      </section>

      <main className="body" style={{ gap: 16, paddingTop: 20, paddingBottom: 24 }}>
        <div className="stack" style={{ gap: 10 }}>
          {BENEFITS.map((benefit) => (
            <div key={benefit.title} className="card card--row" style={{ gap: 14, borderRadius: 18, padding: '14px 16px' }}>
              <div className="avatar" style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--pink)', color: 'var(--red-dark)' }}>
                <Icon name={benefit.icon} />
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{benefit.title}</div>
                <div className="muted" style={{ fontSize: 14 }}>
                  {benefit.text}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <h2 className="eyebrow">How it works</h2>
          <div className="grid3">
            {LOOP.map((step, index) => (
              <div key={step} className="card card--col" style={{ borderRadius: 16, padding: 12, gap: 6 }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--red)' }}>{index + 1}</div>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{step}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="spacer" />
        <div className="actions actions--gap">
          <Link to="/setup" className="btn">
            Continue
          </Link>
          <div className="muted" style={{ fontSize: 13 }}>
            Step 1 of 2
          </div>
        </div>
      </main>
    </Screen>
  );
}
