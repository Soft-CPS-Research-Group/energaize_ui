import './EVChargingLoader.css';

/** One viewBox keeps artwork, wheels and cable aligned, including in the workspace shadow root. */
export function CeramicChargingScene({ mode = 'charging' }: { mode?: 'arrive' | 'depart' | 'charging' }): JSX.Element {
  return <div className={`ceramic-charge-scene is-${mode}`} aria-hidden="true">
    <svg className="ceramic-charge-canvas" viewBox="0 0 480 240" focusable="false">
      <ellipse cx="244" cy="199" rx="221" ry="9" fill="#d9cdb7" opacity=".5" />
      <path d="M29 201H454M82 193l-5 13m68-13-3 14m73-14v14m78-14 3 14m76-14 5 13" stroke="#c2b297" strokeWidth="1" opacity=".4" />
      <image className="ceramic-charge-pedestal" href="/assets/mediterranean/ev-station-v3.webp" x="328" y="30" width="120" height="180" />
      <g className="ceramic-charge-car">
        <image href="/assets/mediterranean/ev-side-v2.webp" x="55" y="32" width="280" height="186.667" />
        {[106.6,281].map(x => <g key={x} transform={`translate(${x} 166.5)`}>
          <g className="ceramic-charge-wheel">
            <circle r="15" fill="#eee5d5" />
            <circle r="12.5" fill="none" stroke="#c5b99f" strokeWidth="1" />
            <path d="M0-11V-4M9.53 5.5 3.46 2M-9.53 5.5-3.46 2" stroke="#a49376" strokeWidth="2.2" strokeLinecap="round" />
            <circle r="3" fill="#c5b99f" />
          </g>
        </g>)}
      </g>
      <g className="ceramic-charge-connection">
        <path className="ceramic-charge-cable" pathLength="100" d="M388 115C369 115 394 187 341 187S259 192 259 130" />
        <path className="ceramic-charge-current" pathLength="100" d="M388 115C369 115 394 187 341 187S259 192 259 130" />
        <rect className="ceramic-charge-plug" x="254" y="124" width="10" height="14" rx="4" fill="#766951" />
      </g>
      <ellipse className="ceramic-charge-spark" cx="388" cy="82" rx="1.7" ry="7" fill="#eff8d9" />
    </svg>
  </div>;
}
