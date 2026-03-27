export function InstitutionalDock(): JSX.Element {
  return (
    <footer className="institutional-dock" aria-label="Institutional partners">
      <div className="institutional-inner">
        <p className="institutional-note">
          OPEVA - OPtimization of Electric Vehicle Autonomy Funded within the Key Digital
          Technologies Joint Undertaking (KDT JU) from the European Union’s Horizon Europe
          Programme and the National Authorities, under grant agreement 101097267.
        </p>

        <div className="institutional-logos">
          <a href="https://www.isep.ipp.pt/" target="_blank" rel="noreferrer" aria-label="ISEP">
            <img className="dock-logo isep-light" src="/assets/logos/ISEP-light.png" alt="ISEP" />
            <img className="dock-logo isep-dark" src="/assets/logos/isep-dark.png" alt="ISEP" />
          </a>
          <a href="https://www2.isep.ipp.pt/softcps/" target="_blank" rel="noreferrer" aria-label="softCPS">
            <img className="dock-logo dock-softcps" src="/assets/logos/softcps.png" alt="softCPS" />
          </a>
          <a href="https://opeva.eu/Quase " target="_blank" rel="noreferrer" aria-label="OPEVA">
            <img className="dock-logo dock-opeva" src="/assets/logos/opeva-light.jpg" alt="OPEVA" />
          </a>
        </div>
      </div>
    </footer>
  );
}
