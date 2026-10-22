import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { kpiSectionFor } from "../../pages/kpi-manager/kpiSections";

interface KpiPageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Controls aligned to the right of the heading (buttons, toggles). */
  actions?: ReactNode;
}

/**
 * Header shared by every KPI Manager page: ceramic section art, eyebrow, title,
 * description and actions — the same pattern as the Predictor and AI workspaces —
 * followed by the section's sub-tabs when it groups several pages.
 */
export function KpiPageHeader({ title, description, actions }: KpiPageHeaderProps): JSX.Element {
  const { pathname } = useLocation();
  const section = kpiSectionFor(pathname);

  return (
    <>
      <header className="jobs-hero ai-jobs-heading kpi-heading">
        <div className="ai-heading-copy">
          <span className={`ai-ceramic-compute kpi-art kpi-art-${section?.art ?? "community"}`} aria-hidden="true" />
          <div>
            <span className="ai-eyebrow">KPI Manager{section ? ` · ${section.label}` : ""}</span>
            <h1>{title}</h1>
            {description ? <p>{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="ai-heading-actions kpi-heading-actions">{actions}</div> : null}
      </header>

      {section?.pages ? (
        <nav className="kpi-subnav" aria-label={`${section.label} pages`}>
          {section.pages.map((page) => (
            <NavLink
              key={page.path}
              to={page.path}
              className={({ isActive }) => `kpi-subnav-tab${isActive ? " is-active" : ""}`}
            >
              {page.label}
            </NavLink>
          ))}
        </nav>
      ) : null}
    </>
  );
}
