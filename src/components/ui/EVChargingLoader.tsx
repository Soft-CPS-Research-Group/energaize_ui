interface EVChargingLoaderProps {
  label?: string;
  compact?: boolean;
}

export function EVChargingLoader({
  label,
  compact = false
}: EVChargingLoaderProps): JSX.Element {
  return (
    <div className={`ev-loader${compact ? " is-compact" : ""}`} role="status" aria-live="polite">
      <div className="ev-loader-track" aria-hidden="true">
        <span className="ev-loader-station" />
        <span className="ev-loader-cable" />
        <span className="ev-loader-energy e1" />
        <span className="ev-loader-energy e2" />
        <span className="ev-loader-energy e3" />
        <span className="ev-loader-car" />
        <span className="ev-loader-pulse" />
      </div>
      {label ? <span className="ev-loader-label">{label}</span> : null}
    </div>
  );
}
