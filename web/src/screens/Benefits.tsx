import { Link } from 'react-router-dom';
import { Cover, Screen } from '../components/ui';
import { useHub } from '../hub';

const BENEFITS: Array<{ title: string; text: string }> = [
  { title: 'Our events, any time', text: 'You are on the guest list by default' },
  { title: 'Free product and merch', text: 'Earn coins, pick what you like' },
  { title: 'Our news first', text: 'Before anyone outside the Hub' },
];
const LOOP = ['Take a task', 'Post and send the link', 'Earn coins, level up'];

/** First open of the mini app, shown once: one photo, three benefits, the loop, one button. */
export function Benefits() {
  const { settings } = useHub();
  return (
    <Screen top="dark">
      <div className="lead lead--square" style={{ minHeight: 'min(56vh, 460px)' }}>
        <Cover src="/brand/welcome.webp" alt="" fill eager style={{ background: 'var(--red)' }} />
        <div className="lead__body" style={{ gap: 14, paddingBottom: 28 }}>
          <div className="label">{settings.brandName} · By invitation</div>
          <h1 className="display" style={{ fontSize: 46 }}>
            Welcome to the family
          </h1>
        </div>
      </div>
      <hr className="thread" />

      <main className="body" style={{ gap: 28, paddingTop: 24 }}>
        <p style={{ fontSize: 17, lineHeight: 1.45, color: 'var(--black)', maxWidth: '30ch' }}>
          A closed community of creators. You are in by invitation.
        </p>

        <ol className="steps steps--plain" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {BENEFITS.map((benefit, index) => (
            <li key={benefit.title} className="step">
              <span className="step__n" aria-hidden="true">
                {index + 1}
              </span>
              <span className="step__text" style={{ fontWeight: 700 }}>
                {benefit.title}
                <small>{benefit.text}</small>
              </span>
            </li>
          ))}
        </ol>

        <section className="section">
          <h2 className="eyebrow">How it works</h2>
          <div className="grid3" style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: 'var(--black)' }}>
            {LOOP.map((step) => (
              <div key={step} className="tile">
                {step}
              </div>
            ))}
          </div>
        </section>

        <div className="dock actions actions--gap">
          <Link to="/setup" className="btn">
            Continue
          </Link>
          <div className="muted t-cap">Step 1 of 2</div>
        </div>
      </main>
    </Screen>
  );
}
