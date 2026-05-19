import type { CSSProperties, ReactNode } from "react";

export interface NetworkArchitectureLayer {
  label: string;
  size?: number | null;
  detail?: string | null;
}

export interface NetworkArchitectureRow {
  id: string;
  label: string;
  inputLabel: string;
  inputDetail?: string | null;
  outputLabel: string;
  outputDetail?: string | null;
  layers: NetworkArchitectureLayer[];
  accent?: string;
}

export interface NetworkArchitectureStat {
  label: string;
  value: ReactNode;
}

interface NetworkArchitectureGraphProps {
  eyebrow?: string;
  title: string;
  description?: string;
  rows: NetworkArchitectureRow[];
  stats?: NetworkArchitectureStat[];
  className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function dotCountForLayer(size: number | null | undefined): number {
  if (!size || !Number.isFinite(size) || size <= 0) return 8;
  return clamp(Math.round(Math.log2(size + 1)), 5, 12);
}

function FlowEdge(): JSX.Element {
  return (
    <span className="network-architecture-edge" aria-hidden="true">
      <span />
    </span>
  );
}

function FlowNode({
  label,
  detail,
  tone = "default"
}: {
  label: string;
  detail?: string | null;
  tone?: "default" | "terminal";
}): JSX.Element {
  return (
    <span className={`network-architecture-node is-${tone}`}>
      <strong>{label}</strong>
      {detail ? <small>{detail}</small> : null}
    </span>
  );
}

function LayerNode({ layer }: { layer: NetworkArchitectureLayer }): JSX.Element {
  const dots = Array.from({ length: dotCountForLayer(layer.size) }, (_, index) => index);
  return (
    <span className="network-architecture-layer">
      <span className="network-architecture-layer-dots" aria-hidden="true">
        {dots.map((dot) => (
          <i key={dot} />
        ))}
      </span>
      <span className="network-architecture-layer-copy">
        <strong>{layer.size ? layer.size.toLocaleString("en-US") : layer.label}</strong>
        <small>{layer.size ? layer.label : layer.detail}</small>
      </span>
    </span>
  );
}

export function NetworkArchitectureGraph({
  eyebrow,
  title,
  description,
  rows,
  stats,
  className
}: NetworkArchitectureGraphProps): JSX.Element {
  return (
    <section className={`network-architecture${className ? ` ${className}` : ""}`}>
      <header className="network-architecture-head">
        <div>
          {eyebrow ? <span className="config-mini-label">{eyebrow}</span> : null}
          <h4>{title}</h4>
        </div>
        {description ? <p>{description}</p> : null}
      </header>

      <div className="network-architecture-stage">
        {rows.map((row) => (
          <article
            key={row.id}
            className="network-architecture-row"
            style={{ "--network-accent": row.accent || "#2563eb" } as CSSProperties}
          >
            <div className="network-architecture-row-title">
              <strong>{row.label}</strong>
              <small>{row.layers.length} {row.layers.length === 1 ? "stage" : "stages"}</small>
            </div>
            <div className="network-architecture-flow">
              <FlowNode label={row.inputLabel} detail={row.inputDetail} tone="terminal" />
              {row.layers.map((layer, index) => (
                <span key={`${row.id}-${index}`} className="network-architecture-hop">
                  <FlowEdge />
                  <LayerNode layer={layer} />
                </span>
              ))}
              <span className="network-architecture-hop">
                <FlowEdge />
                <FlowNode label={row.outputLabel} detail={row.outputDetail} tone="terminal" />
              </span>
            </div>
          </article>
        ))}
      </div>

      {stats && stats.length > 0 ? (
        <dl className="network-architecture-stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
