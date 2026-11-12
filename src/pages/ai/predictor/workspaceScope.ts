import type { CommunitySite } from "../../../data/communityDomain";
import type { ModelMeta } from "../../../api/analysisApi";
import { GENERIC_HOUSE_ID } from "../../../api/predictorApi";

/**
 * Community workspaces of the predictor.
 *
 * The predictor names a house after its Mongo collection: `building_R-H-01` is
 * house `R-H-01`. A community site says which collection holds its readings
 * through an external reference set in the site settings:
 *   - `perceptor-site`: the collection name, e.g. `building_R-H-01`;
 *   - `percepta-mongo`: `database/collection`, e.g. `living_lab/building_R-H-01`.
 * A site without one of these is not matched by name: site names, spreadsheet
 * rows and predictor ids are unrelated.
 */

export const LABORATORY_WORKSPACE_ID = "laboratory";

const COLLECTION_PREFIX = "building_";

/** The predictor house a site's readings belong to, or null when the site has no source reference. */
export function siteHouseId(site: Pick<CommunitySite, "external_references">): string | null {
  const refs = site.external_references ?? [];
  const collection =
    refs.find((r) => r.system === "perceptor-site")?.identifier?.trim() ||
    refs.find((r) => r.system === "percepta-mongo")?.identifier?.split("/").pop()?.trim();
  if (!collection) return null;
  const house = collection.startsWith(COLLECTION_PREFIX) ? collection.slice(COLLECTION_PREFIX.length) : collection;
  return house || null;
}

export interface CommunityHouses {
  /** Houses of the community that the predictor forecasts, sorted. */
  houses: string[];
  /** Sites of the community with no measurement source reference. */
  unlinked: CommunitySite[];
  /** Sites whose source the predictor does not forecast, with the house id they point to. */
  notForecast: { site: CommunitySite; houseId: string }[];
}

/** Splits a community's sites into the predictor houses they map to and the ones that cannot be shown. */
export function communityHouses(sites: CommunitySite[], recId: string, predictorHouses: string[]): CommunityHouses {
  const known = new Set(predictorHouses);
  const houses = new Set<string>();
  const unlinked: CommunitySite[] = [];
  const notForecast: { site: CommunitySite; houseId: string }[] = [];
  for (const site of sites) {
    if (site.assigned_rec_id !== recId) continue;
    const houseId = siteHouseId(site);
    if (!houseId) unlinked.push(site);
    else if (known.has(houseId)) houses.add(houseId);
    else notForecast.push({ site, houseId });
  }
  return { houses: [...houses].sort(), unlinked, notForecast };
}

/**
 * Whether a house belongs to the workspace. `scope` null is the Laboratory (every house).
 * The generic model (no house, or the "cold_start" job id) is shared by every workspace.
 */
export function houseInScope(scope: ReadonlySet<string> | null, houseId: string | null | undefined): boolean {
  if (!scope || !houseId || houseId === GENERIC_HOUSE_ID) return true;
  return scope.has(houseId);
}

/**
 * The models a workspace shows: its houses' models and the generic ones. A generic
 * model's uses are narrowed to the workspace, so "In use · N houses" counts its houses.
 */
export function scopeModels(models: ModelMeta[], scope: ReadonlySet<string> | null): ModelMeta[] {
  if (!scope) return models;
  return models
    .filter((m) => houseInScope(scope, m.house_id))
    .map((m) => {
      if (m.house_id || !m.in_use_by) return m;
      const uses = m.in_use_by.filter((u) => scope.has(u.house_id));
      return { ...m, in_use_by: uses, active: uses.length > 0 };
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tells whether a log line belongs to the workspace: lines that name no house are
 * service-wide and always kept; lines that name houses are kept when one of them is in scope.
 * A house id only counts as a whole word, so R-H-01 does not match inside R-H-010.
 */
export function logLineFilter(allHouses: string[], scope: ReadonlySet<string> | null): (raw: string) => boolean {
  if (!scope || allHouses.length === 0) return () => true;
  // Longest first, so a house whose id contains another's is matched whole.
  const ids = [...new Set(allHouses)].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\w-])(${ids.map(escapeRegExp).join("|")})(?![\\w-])`, "g");
  return (raw) => {
    let named = false;
    for (const match of raw.matchAll(pattern)) {
      if (scope.has(match[1])) return true;
      named = true;
    }
    return !named;
  };
}
