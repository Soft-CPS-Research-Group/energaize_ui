import { Minus, TrendingDown, TrendingUp } from "lucide-react";

/**
 * Change between two KPI values, coloured by whether it is an improvement:
 * for KPIs where lower is better (cost, ramping, inequality) a decrease is good.
 */
export function KpiDelta({ absolute, relativePct, lowerIsBetter = false }: {
  absolute: number | null | undefined;
  relativePct: number | null | undefined;
  lowerIsBetter?: boolean;
}): JSX.Element {
  if (absolute == null) return <span className="kpi-text-soft">—</span>;

  const isIncrease = absolute > 0;
  const tone = absolute === 0 ? "soft" : (lowerIsBetter ? !isIncrease : isIncrease) ? "ok" : "danger";
  const Icon = absolute === 0 ? Minus : isIncrease ? TrendingUp : TrendingDown;
  const verdict = absolute === 0 ? "no change" : tone === "ok" ? "improvement" : "worse";

  return (
    <span className={`kpi-delta kpi-text-${tone}`} title={verdict}>
      <Icon size={14} aria-hidden="true" />
      {isIncrease ? "+" : ""}{absolute.toFixed(3)}
      {relativePct != null ? <small>({relativePct > 0 ? "+" : ""}{relativePct.toFixed(1)}%)</small> : null}
      <span className="sr-only">, {verdict}</span>
    </span>
  );
}
