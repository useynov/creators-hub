import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Me } from '../../../server/src/types';
import { api } from '../api';
import { Screen, TopBar } from '../components/ui';
import { useAction, useHub, useToast } from '../hub';
import { buzz } from '../telegram';
import { SIZES } from './Redeem';

/** Everything the quick setup skipped. Nothing here is required until an order needs it. */
export function Details() {
  const { me, refresh } = useHub();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({
    tiktok: me.tiktok ? `@${me.tiktok}` : '',
    city: me.city ?? '',
    size: me.size ?? '',
    address: me.address ?? '',
    phone: me.phone ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  const [save, saving] = useAction(async () => {
    await api.patch<Me>('/api/me', form);
    await refresh();
    buzz('success');
    toast('Saved.');
    navigate('/profile');
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save();
  };

  const text = (id: keyof typeof form, label: string, placeholder: string, type = 'text') => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type={type}
        autoCapitalize={id === 'tiktok' ? 'none' : undefined}
        placeholder={placeholder}
        value={form[id]}
        onChange={(event) => set(id)(event.target.value)}
      />
    </div>
  );

  return (
    <Screen>
      <TopBar back="/profile" backLabel="Back to profile" title="My details" />
      <form className="body" style={{ gap: 16 }} onSubmit={submit} noValidate>
        <div className="form">
          <div className="field">
            <span style={{ fontSize: 15, fontWeight: 700 }}>Instagram account</span>
            <Link to="/profile/instagram" className="input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--ink)' }}>
              <span>{me.instagram ? `@${me.instagram}` : 'Connect your account'}</span>
              <span className="textlink" style={{ fontSize: 15 }}>
                Change
              </span>
            </Link>
          </div>
          {text('tiktok', 'TikTok handle', '@yourhandle')}
          {text('city', 'City', 'Almaty')}
          <fieldset className="field">
            <legend>Clothing size</legend>
            <div className="sizes">
              {SIZES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="pill"
                  aria-pressed={form.size === option}
                  onClick={() => set('size')(form.size === option ? '' : option)}
                >
                  {option}
                </button>
              ))}
            </div>
          </fieldset>
          {text('address', 'Delivery address', 'City, street, building, apartment')}
          {text('phone', 'Phone for the courier', '+7', 'tel')}
        </div>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
          We use the size and address for merch orders, and the handles to count the views on your posts.
        </p>
        <div className="spacer" />
        <button type="submit" className="btn" disabled={saving}>
          Save
        </button>
      </form>
    </Screen>
  );
}
