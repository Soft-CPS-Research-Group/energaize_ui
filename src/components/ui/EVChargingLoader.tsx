import { CeramicChargingScene } from './CeramicChargingScene';
import './EVChargingLoader.css';

export function EVChargingLoader({ label, compact = false }: { label?: string; compact?: boolean }): JSX.Element {
  return <div className={`ev-loader${compact ? ' is-compact' : ''}`} role="status" aria-live="polite" aria-label={label ? undefined : 'Loading'}>
    <CeramicChargingScene />
    {label ? <span className="ev-loader-label">{label}</span> : null}
  </div>;
}
