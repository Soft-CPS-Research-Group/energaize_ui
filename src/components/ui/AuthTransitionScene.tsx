import { CeramicChargingScene } from './CeramicChargingScene';
import './AuthTransitionScene.css';

export function AuthTransitionScene({ mode, line }: { mode: 'login' | 'logout'; line: string }): JSX.Element {
  return <div className="auth-scene-overlay ceramic-transition-overlay">
    <div className={`ceramic-auth-scene is-${mode}`} role="status" aria-live="polite">
      <CeramicChargingScene mode={mode === 'login' ? 'arrive' : 'depart'} />
      <p>{mode === 'login' ? 'Connecting to your energy space.' : 'Until next time.'}</p>
      <span className="ceramic-auth-status">{line}</span>
    </div>
  </div>;
}
