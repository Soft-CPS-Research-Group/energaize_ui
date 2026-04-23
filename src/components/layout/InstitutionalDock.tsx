type DockLogo = {
  id: string;
  href: string;
  label: string;
  lightSrc?: string;
  darkSrc?: string;
  src?: string;
  className?: string;
};

const DOCK_LOGOS: DockLogo[] = [
  {
    id: "opeva",
    href: "https://opeva.eu/",
    label: "OPEVA",
    src: "/assets/logos/opeva-light.jpg",
    className: "dock-logo-opeva"
  },
  {
    id: "softcps",
    href: "https://www2.isep.ipp.pt/softcps/",
    label: "softCPS",
    src: "/assets/logos/softcps.png",
    className: "dock-logo-softcps"
  },
  {
    id: "isep",
    href: "https://www.isep.ipp.pt/",
    label: "ISEP",
    lightSrc: "/assets/logos/ISEP-light.png",
    darkSrc: "/assets/logos/logoISEP.png",
    className: "dock-logo-isep"
  },
  {
    id: "i-charging",
    href: "https://i-charging.tech/",
    label: "i-charging",
    lightSrc: "/assets/logos/icharging_light.png",
    darkSrc: "/assets/logos/logo_i_charging_dark.png",
    className: "dock-logo-icharging"
  },
  {
    id: "chips",
    href: "https://cleanwattsdigital.com/",
    label: "Cleanwatts Digital",
    src: "/assets/logos/CWD.svg",
    className: "dock-logo-cw"
  },
  {
    id: "digital-rp",
    href: "https://www.portugal.gov.pt/pt/gc25",
    label: "Portuguese Republic",
    src: "/assets/logos/Digital_RP_4C.svg",
    className: "dock-logo-digital"
  },
  {
    id: "fct",
    href: "https://www.fct.pt/",
    label: "FCT",
    lightSrc: "/assets/logos/fct_light.jpg",
    darkSrc: "/assets/logos/fct_dark.jpg",
    className: "dock-logo-fct"
  },
  {
    id: "la-p-0063-2020",
    href: "https://portugal2030.pt/?gad_source=1&gad_campaignid=23519682922&gclid=Cj0KCQjwm6POBhCrARIsAIG58CIxyeYCI7d79MG8QCuw-4oXhydipKuWAollsX_ixlGbXLxGWjFgt88aAroZEALw_wcB",
    label: "Portugal 2030",
    src: "/assets/logos/PRD_PDQI(1).png",
    className: "dock-logo-prd"
  }
];

export function InstitutionalDock(): JSX.Element {
  return (
    <footer className="institutional-dock" aria-label="Institutional partners">
      <div className="institutional-inner">
        <div className="institutional-note-wrap">
          <p className="institutional-note institutional-note-compact">
            Funded by OPEVA (Chips JU, Horizon Europe, grant 101097267) and by FCT via
            LA/P/0063/2020 (DOI:10.54499/LA/P/0063/2020) and grant 2024.00855.BD.
          </p>
          <details className="institutional-note-more">
            <summary>Full funding disclaimer</summary>
            <p className="institutional-note">
              This work is supported by the OPEVA project that has received funding within the Chips
              Joint Undertaking (Chips JU) from the European Union&apos;s Horizon Europe Programme and
              the National Authorities (France, Czechia, Italy, Portugal, Turkey, Switzerland), under
              grant agreement 101097267. The work is also partially financed by National Funds through
              the Portuguese funding agency, FCT - Fundacao para a Ciencia e a Tecnologia, within
              project LA/P/0063/2020. DOI:10.54499/LA/P/0063/2020 and through the FCT individual
              research grant 2024.00855.BD. Views and opinions expressed are however those of the
              authors only and do not reflect those of the European Union, Chips JU or FCT. Neither
              the European Union nor the granting authorities can be held responsible for them.
            </p>
          </details>
        </div>

        <div className="institutional-logos">
          {DOCK_LOGOS.map((logo) => (
            <a key={logo.id} href={logo.href} target="_blank" rel="noreferrer" aria-label={logo.label}>
              {logo.lightSrc && logo.darkSrc ? (
                <>
                  <img
                    className={`dock-logo dock-logo-light${logo.className ? ` ${logo.className}` : ""}`}
                    src={logo.lightSrc}
                    alt=""
                    aria-hidden="true"
                  />
                  <img
                    className={`dock-logo dock-logo-dark${logo.className ? ` ${logo.className}` : ""}`}
                    src={logo.darkSrc}
                    alt=""
                    aria-hidden="true"
                  />
                </>
              ) : (
                <img
                  className={`dock-logo${logo.className ? ` ${logo.className}` : ""}`}
                  src={logo.src}
                  alt=""
                  aria-hidden="true"
                />
              )}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
