import { useEffect, useState } from 'react';
import { LOGIN_BACKGROUNDS } from '../../constants';
import './AuthBackdrop.css';

/** Shared photographic scene for Jobs and the Community Console. */
export function AuthBackdrop({ images = LOGIN_BACKGROUNDS, showMotionControl = true }: { images?: readonly string[]; showMotionControl?: boolean }): JSX.Element {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (paused || reduced) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex(value => (value + 1) % images.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [paused, reduced, images.length]);
  return <>
    <div className="auth-backdrop" aria-hidden="true">
      {images.map((url, i) => <div key={url} className={`auth-backdrop-image${i === index ? ' is-visible' : ''}`} style={{ backgroundImage: `url("${url}")` }} />)}
      <div className="auth-backdrop-shade" />
    </div>
    {showMotionControl && !reduced && <button className="auth-motion-toggle" type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'Resume backgrounds' : 'Pause backgrounds'}</button>}
  </>;
}
