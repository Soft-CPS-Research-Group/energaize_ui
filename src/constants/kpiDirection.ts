// KPIs where a lower value is the better outcome, used to colour changes (KpiDelta).
// Names must match the class names registered in kpi_factory.py._SCHEDULED_KPI_REGISTRY.
export const LOWER_IS_BETTER = new Set([
  "EnergyCostKPI",               // lower cost = better
  "DailyLoadFactorKPI",          // lower inefficiency = better (0 = flat profile)
  "RampingKPI",                  // lower ramping = smoother grid
  "NoHarmIndicatorKPI",          // 0% = no member is worse off
  "GiniBenefitsKPI",             // 0 = perfect equality
  "BenefitConcentrationCR20KPI", // ~0.2 = proportional distribution
]);
