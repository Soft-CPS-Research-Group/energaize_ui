import { Box, Radio, ArrowRight } from "lucide-react";
import type { RuntimeSnapshot } from "../api/runtimeApi";
type Channel = {
  name?: string;
  description?: string;
  capability_type?: string;
  tag?: string;
  source?: string;
  external_device_id?: string;
  source_field?: string;
  unit?: string;
  canonical_unit?: string;
  sampling_interval_seconds?: number;
};
type Profile = {
  asset_id: string;
  asset_name?: string;
  capabilities?: Channel[];
  channels?: Channel[];
};
type Payload = {
  signal_catalogues?: Array<{ site_id?: string; profiles?: Profile[] }>;
};
/** Visualise only the exported catalogue. It is not a probe of running provider modules. */
export function RuntimeConfiguration({
  snapshot,
}: {
  snapshot: RuntimeSnapshot;
}) {
  const payload = (snapshot.payload || {}) as Payload;
  const profiles =
    payload.signal_catalogues?.flatMap((c) => c.profiles || []) || [];
  return (
    <div className="runtime-catalogue">
      <p className="runtime-note">
        Prepared from the current site inventory. This is not confirmation of
        the configuration loaded by a running instance.
      </p>
      {profiles.length ? (
        profiles.map((profile, i) => (
          <section
            className="runtime-asset-map"
            key={profile.asset_id + ":" + i}
          >
            <header>
              <Box size={22} />
              <div>
                <h3>{profile.asset_name || "Equipment"}</h3>
                <small>
                  {(profile.channels || profile.capabilities || []).length}{" "}
                  configured channels
                </small>
              </div>
            </header>
            <div className="runtime-channel-map">
              {(profile.channels || profile.capabilities || []).map((c, j) => (
                <div className="runtime-channel-path" key={j}>
                  <div>
                    <span className="eyebrow">
                      {["actuator", "action"].includes(c.capability_type || "")
                        ? "COMMAND DESTINATION"
                        : "COLLECTION SOURCE"}
                    </span>
                    <strong>{c.source || "Source not assigned"}</strong>
                    <small>
                      {c.tag
                        ? `Tag ${c.tag}`
                        : c.external_device_id || "Reference missing"}
                      {c.source_field ? ` · ${c.source_field}` : ""}
                    </small>
                  </div>
                  <ArrowRight
                    size={17}
                    style={{
                      transform: ["actuator", "action"].includes(
                        c.capability_type || "",
                      )
                        ? "rotate(180deg)"
                        : undefined,
                    }}
                  />
                  <div>
                    <strong>
                      {c.description || c.name || "Unnamed channel"}
                    </strong>
                    <small>
                      {c.canonical_unit || c.unit || "Unit unconfirmed"}
                      {c.sampling_interval_seconds
                        ? ` · every ${c.sampling_interval_seconds} s`
                        : ""}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="runtime-empty">
          <Radio />
          <p>No channels eligible for collection in this configuration.</p><p>Only enabled channels without a local simulation binding are exported. Check the equipment’s channel settings to prepare a real data source.</p>
        </div>
      )}
    </div>
  );
}
