import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bootstrap } from '../../server/src/types';
import { errorText } from './api';
import { buzz } from './telegram';

// --- Who is using the app, and the hub's settings --------------------------

interface Hub extends Bootstrap {
  /** Re-reads balance, rating and level after something changed them. */
  refresh: () => Promise<unknown>;
  botLink: string | null;
}

const HubContext = createContext<Hub | null>(null);
export const HubProvider = HubContext.Provider;

export function useHub(): Hub {
  const hub = useContext(HubContext);
  if (!hub) throw new Error('useHub must be used inside the app shell');
  return hub;
}

// --- Toasts ----------------------------------------------------------------

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((next: string) => {
    window.clearTimeout(timer.current);
    setMessage(next);
    timer.current = window.setTimeout(() => setMessage(null), 3500);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// --- Running a server action from a button ---------------------------------

/** Wraps an async action: tracks "busy", and turns a failure into a toast. */
export function useAction<A extends unknown[]>(action: (...args: A) => Promise<void>): [(...args: A) => void, boolean] {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const latest = useRef(action);
  latest.current = action;

  const run = useCallback(
    (...args: A) => {
      if (busy) return;
      setBusy(true);
      buzz('tap');
      latest.current(...args)
        .catch((error: unknown) => {
          buzz('error');
          toast(errorText(error));
        })
        .finally(() => setBusy(false));
    },
    [busy, toast],
  );
  return [run, busy];
}
