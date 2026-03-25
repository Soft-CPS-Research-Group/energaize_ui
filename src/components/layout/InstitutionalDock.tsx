export function InstitutionalDock(): JSX.Element {
  return (
    <footer className="institutional-dock" aria-label="Institutional partners">
      <div className="institutional-inner">
        <span className="institutional-label">Funded by the European Union</span>
        <img className="dock-logo isep-light" src="/assets/logos/ISEP-light.png" alt="ISEP" />
        <img className="dock-logo isep-dark" src="/assets/logos/isep-dark.png" alt="ISEP" />
        <img className="dock-logo dock-softcps" src="/assets/logos/softcps.png" alt="softCPS" />
        <img className="dock-logo dock-opeva" src="/assets/logos/opeva-light.jpg" alt="OPEVA" />
      </div>
    </footer>
  );
}
