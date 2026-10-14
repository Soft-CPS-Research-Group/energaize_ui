import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AuthTransitionScene } from '../components/ui/AuthTransitionScene';

export const AUTH_TRANSITION_DURATION_MS = 3000;
interface TransitionControls {
  pending: boolean;
  begin: (line: string) => void;
  ready: () => void;
  cancel: () => void;
}
const AuthTransitionContext = createContext<TransitionControls | null>(null);

/** Lives above routing so the real destination mounts during the same animation. */
export function AuthTransitionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [line, setLine] = useState('');
  const timer = useRef<number>();
  const begin = useCallback((message: string) => {
    window.clearTimeout(timer.current);
    setLine(message); setElapsed(false); setPrepared(false); setPending(true);
    timer.current = window.setTimeout(() => setElapsed(true), AUTH_TRANSITION_DURATION_MS);
  }, []);
  const ready = useCallback(() => setPrepared(true), []);
  const cancel = useCallback(() => { window.clearTimeout(timer.current); setPending(false); }, []);
  useEffect(() => { if (pending && elapsed && prepared) setPending(false); }, [pending, elapsed, prepared]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <AuthTransitionContext.Provider value={{ pending, begin, ready, cancel }}>
    <div className="auth-transition-content" aria-hidden={pending || undefined} {...(pending ? { inert: '' } : {})}>{children}</div>
    {pending && <AuthTransitionScene mode="login" line={line} />}
  </AuthTransitionContext.Provider>;
}
export function useAuthTransition(): TransitionControls {
  const context = useContext(AuthTransitionContext);
  if (!context) throw new Error('useAuthTransition must be used inside AuthTransitionProvider');
  return context;
}
