export function InstitutionalDock(): JSX.Element {
  return (
    <footer className="institutional-dock" aria-label="Institutional partners">
      <div className="institutional-inner">
        <a
          className="institutional-label"
          href="https://european-union.europa.eu/"
          target="_blank"
          rel="noreferrer"
        >
          Funded by the European Union
        </a>
        <a href="https://www.isep.ipp.pt/" target="_blank" rel="noreferrer" aria-label="ISEP">
          <img className="dock-logo isep-light" src="/assets/logos/ISEP-light.png" alt="ISEP" />
          <img className="dock-logo isep-dark" src="/assets/logos/isep-dark.png" alt="ISEP" />
        </a>
        <a href="https://softcps.com/" target="_blank" rel="noreferrer" aria-label="softCPS">
          <img className="dock-logo dock-softcps" src="/assets/logos/softcps.png" alt="softCPS" />
        </a>
        <a href="https://opeva.inesctec.pt/" target="_blank" rel="noreferrer" aria-label="OPEVA">
          <img className="dock-logo dock-opeva" src="/assets/logos/opeva-light.jpg" alt="OPEVA" />
        </a>
      </div>
    </footer>
  );
}
