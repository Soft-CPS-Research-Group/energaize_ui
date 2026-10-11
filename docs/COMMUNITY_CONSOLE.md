# Connected Community Console

The REC/member workspace is part of the same React application as Jobs, KPI and predictor. All users enter through `/login`, using the original Jobs login. `/communities` and `/app/community/*` render the new backend-connected views directly. The previous UI source is retained for reference; the old `/console/index.html` URL only redirects to the application.

## Local use

1. Start the four services in `bounded-context-be`: `docker compose -f compose.community-local.yml up -d --build --wait`.
2. For synthetic local accounts only, run `npm run seed:console`. This creates Console Sandbox and two test houses, without changing workbook ownership. Do not run the seed against production.
3. Run `npm run dev:console` and open `http://127.0.0.1:5177/login`.
4. Test login: `rec@energaize.io / rec123` (manager), `prosumer@energaize.io / pros123` (resident). Other registered member emails use the same test password. Password validation in this UI is deliberately mocked; it is not production authentication. Account menus do not permit impersonation.

`AuthProvider` owns the only session. Community sign-in resolves registered users and active manager grants from Community/Access Control; the fixed test passwords remain. Jobs/KPI/predictor test accounts retain their existing credentials. Logout uses the shared account menu and clears the common session. `dev:console` starts the complete app on port 5177.

The resident enters the selected site's overview, and can switch only among their own active sites. The selection is remembered per user. Membership alone does not grant site ownership. Vehicles require independent asset ownership. Access checks are queried from Access Control when loading the member workspace and again before writes.

## Service connections

| Browser route | Local service | Used for |
| --- | --- | --- |
| `/community-api` | localhost:8017 | RECs, sites, assets, users and ownership CRUD |
| `/access-api` | localhost:8018 | Roles, grants, permission checks, relationship reconciliation |
| `/telemetry-api` | localhost:8019 | Asset profiles, generic channel/tag creation and updates |
| `/flexibility-api` | localhost:8020 | Session/calendar reads; asset eligibility tested; editing deferred |
| `/measurement-api` | 193.136.62.78:8000 | Existing historical/streaming data API; separate from inventory |

Vite targets are configurable with the `*_PROXY_TARGET` variables in `.env.example`. Nginx retains the configured server targets and adds the separate measurement proxy. Deployments must have reachable upstream services. No server deployment was performed by this change.

The historical service was found in the existing `src/api/communityDataApi.ts`. Both inventory and historical queries previously shared `/community-api`, despite requiring different upstreams. History now uses `/measurement-api`, including its existing WebSocket route.

## Measurement mapping

The existing service exposes `/energy-communities` and `/historical-data/{database}`. Collection IDs such as `building_R-H-01` do not equal Community site UUIDs or Excel participant IDs. Configure both under Site settings:

- external reference system `perceptor-community`, identifier = exact database name;
- external reference system `perceptor-site`, identifier = exact collection name.

The form validates both against the service before saving and preserves other external references. No mappings were inferred from personal names, spreadsheet rows, or matching counts. Tags remain opaque strings in Telemetry.

Site history displays only the selected collection, with hour/day/week windows and explicit refresh. The legacy server still queries every collection in the community; client-side selection does not make that request site-scoped. Requests use at most 500 raw samples per collection, without the legacy Python aggregation path. A window can therefore be incomplete. Automatic historical polling is disabled until a scoped incremental API exists. The legacy energy fields stay in kWh, never relabelled as kW. Null/missing observations remain missing, not zero. The current API response for `living_lab`, last 24 hours, had four known collections but no samples. An empty graph is therefore intentional. Device-specific observation mapping and true streaming updates remain separate follow-up work.

## Implemented writes and explicit gaps

Connected writes: user profiles, memberships, dated site access, direct asset ownership, community identity/cadence/manager, site name/grid limits/data references, and channel configuration. Success is displayed only after the backend response and reload. Multi-channel saves are separate API transactions; an error reports the number already saved.

Creating sites/assets, full contract editors, deployment/algorithm control, Excel-upload UI and the advanced flexibility UI remain unfinished. Their former prototype actions must not pretend to persist changes. REC manager authority is scoped by backend grants. Mobile EV management still needs explicit asset authority when no community association exists. CRUD endpoints themselves do not yet enforce a production authenticated principal.

## Verification

- `node --test tests/console/*.test.cjs`: transport failures, separated routes, exact tags, duplicate asset kinds, missing readings and collection isolation.
- `node scripts/checkConsoleBackends.mjs`: real local Community ownership round-trip, Access inheritance/revocation, Telemetry tag round-trip, Flexibility → Community eligibility, and read-only legacy measurement query. Temporary records are removed and edited tags restored.
- Existing targeted ownership tests and `npm run build`.
- Browser checks: login/logout, direct site overview, site switching, account menu, site settings persistence across reloads.

## Legacy measurement API investigation (2026-10-11)

Source: `Soft-CPS-Research-Group/opeva_backend_api_training`, locally `/home/tiago/dev/opeva_backend_api_training`. Infrastructure deploys `calof/opeva_backend_api_training:latest` on port 8000. Perceptor ingestion is separate (the `percepta` infrastructure service); the Telemetry bounded context stores channel configuration rather than measurements.

Concrete code findings, not latency measurements:

- `app/services/mongo_service.py`: historical requests traverse all collections sequentially; there is no site/signal filter. The aggregation branch materializes all matching documents before Python aggregation and only then paginates. Raw queries are bounded per collection, but the endpoint does not cap the caller's limit.
- That aggregation averages top-level numeric values; nested observation dictionaries retain a bucket's first value rather than receiving metric-aware aggregation. This is a correctness issue as well as a performance concern.
- `app/controllers/mongo_controller.py`: async handlers call synchronous Mongo services directly.
- `app/controllers/websocket_controller.py` sends to clients sequentially. A slow client can hold up others and the Rabbit callback; there is no per-client bounded queue or send timeout in that path.
- `app/rabbitMQ_adapter.py`: message acknowledgement waits for the callback. No compression/decompression was found in this delivery path; the reported compression delay still needs locating and measurement.
- `/energy-communities` enumerates Mongo database names; these are not inventory REC records. The connected console selects communities from Community & Infrastructure instead.

Next design work: benchmark database, serialization and delivery separately; inspect timestamp indexes with query plans; introduce explicit site/signal filters and bounded time windows, cursor pagination, server-side metric-aware rollups, and a latest-value endpoint/cache. Power, interval energy, cumulative counters and SoC need different aggregation rules. Fetch history once, then deliver incremental readings through bounded client queues with slow-client handling. Keep explicit mapping from inventory UUIDs/tags to measurement sources. No telemetry service redesign or remote deployment was performed during this UI correction.

## Transition audit and agreed scope (2026-10-11)

Decision: the connected console is the only active REC manager/resident workspace. Keep the old community UI source for reference; do not restore its database-derived selector, automatically import database names as RECs, or delete the old service yet. This decision does not retire Jobs, Deploy, KPI or predictor workspaces.

Preserved references: `src/pages/community/`, `src/components/layout/AppShell.tsx`, `src/api/communityDataApi.ts`, `src/hooks/useRealTimeData.ts`, and the separate `opeva_backend_api_training` repository. The static console is now maintained in this UI repository; no legacy code removal was made in this audit.

### Communities visible locally

Read from Community API on 2026-10-11, without changing records:

| Record | Explanation | Local inventory |
| --- | --- | --- |
| DEMFLEX LivingLab | Workbook inventory imported into the new domain | 36 sites, 59 installed assets; vehicles are separate |
| Console Sandbox | Synthetic community created by `scripts/seedConsoleDemo.mjs` to verify login, ownership and switching between two owned sites | Demo Home, Demo Second Home, one grid meter each |
| REC Revista 897d8b6541 | Pre-existing local record with a generated-looking suffix, one unnamed site and one grid meter. Likely an earlier manual validation record; its exact creation provenance was not found in the scripts or notes inspected. | 1 site, 1 grid meter |

No records were deleted, hidden or renamed. Sandbox is explicitly synthetic. Do not label the other record as definitively synthetic until its provenance is established. The old `/energy-communities` endpoint enumerates Mongo database names, excluding only system databases. Those names can represent sources, experiments or unrelated data; absence from the new REC selector is not evidence of lost communities or measurements.

### Why the charts are empty

All 36 LivingLab sites currently lack the `perceptor-site` source mapping required by the temporary history adapter. The combined catalogue exports 63 profiles and 604 capabilities across local communities, including 74 nonempty tags; all 604 capabilities are currently disabled. These are configuration facts, not measurements or proof that the separate, already-running Perceptor has stopped collecting.

The default Perceptor configuration export filters for enabled capabilities, so it currently exposes no enabled channels. Do not bulk-enable them before checking source, unit, value/timestamp semantics and device identity. No code inspected proves that the deployed Perceptor already consumes this new export; that integration remains to be verified and implemented if missing.

The new console supports manually requested site history through a compatibility proxy to the old API when a source is mapped. Community aggregation, per-channel history, last-value/freshness delivery and live subscription are not implemented in the new console. The old WebSocket helper still exists as reference but is not wired into `public/console/`.

### Old service responsibilities and replacement coverage

Checked the running old service's OpenAPI on port 8000: 16 HTTP operations match the local endpoint inventory. Checked the four running new OpenAPI descriptions: Community 71, Access 14, Telemetry catalogue 14 and Flexibility 29 HTTP operations. Counts are inventory evidence, not feature-completeness claims. WebSocket routes do not appear in OpenAPI; the existing `/ws/data` flow was verified in source, not load-tested against the running broker.

| Old function | Current new coverage | Transition decision |
| --- | --- | --- |
| Mongo database list (`GET /energy-communities`) used as community selection | Community has actual REC/site/asset records, contracts, people and import | Selector is replaced. Keep source discovery separate from REC identity. |
| Historical Mongo readings (`GET /historical-data/{energy_community}`) | None of the four new services stores or serves measurement series; UI has an explicit compatibility adapter | Build a scoped measurement query service for Perceptor data before retiring this endpoint. |
| Rabbit-to-browser bridge (`/ws/data?exchange_name=...`) | No equivalent live endpoint or subscription in the new console | Provide a measurement stream adapter, with filtering, bounded queues and reconnection; never connect browsers directly to AMQP. |
| Arbitrary JSON schemas (`POST /schema/create`, `PUT /schema/update/{site}`, `GET /schema/{site}`) | Typed inventory and signal catalogue cover some concepts, but not arbitrary schema compatibility | Identify schema producers/consumers, classify payloads and migrate needed fields or retain an adapter. Do not claim automatic equivalence. |
| Inference target list, health and model-bundle switch (3 HTTP operations) | No replacement in Community/Access/Telemetry/Flexibility | Keep working Deploy API; assign migration to execution/orchestrator work, not inventory. |
| Inference log streaming and paged history (2 operations) | No replacement in the four contexts | Preserve for Deploy and DeployCharts until an execution service provides parity. |
| Bundle list, file list/content, folder upload and delete (5 operations) | No replacement in the four contexts | Retain artifact lifecycle and storage until migrated with the execution service. |
| Service health | Each new service has health | Already covered for those services, not a substitute for old-service consumers. |

Evidence for the Deploy dependency: `src/api/deployApi.ts` calls the old base URL through `src/api/client.ts`; `DeployPage.tsx` and `DeployChartsPage.tsx` consume it. Jobs, queues, hosts, configs and datasets use the separate orchestrator base URL, usually port 8011. The old repository name does not imply that it currently owns all training jobs.

### Intended measurement flow — proposal, not implemented

Configuration: Community inventory + Telemetry catalogue → Perceptor configuration export → Perceptor. Keep the four domain services communicating through REST as agreed.

History: Perceptor storage → measurement read API → browser. Live, if the existing producer continues publishing to Rabbit: existing Rabbit → server-side measurement adapter → WebSocket/SSE → browser. A broker can remain inside that measurement pipeline without reintroducing it between the four domain services. The alternative is a Perceptor HTTP stream; choose after inspecting its implementation. No new Rabbit instance, exposed broker port or deployment change is needed for this audit.

The user-facing term “Telemetry” can encompass both configuration and readings. Operationally, the current port-8019 service is only the catalogue. Prefer an independent measurement read/stream module alongside Perceptor; whether it is exposed under one gateway or deployed separately is a later deployment decision. Do not put all time-series ingestion into Community or pretend the current catalogue already serves live values.

Recommended implementation sequence:

1. Inspect deployed Perceptor configuration, producer message examples and storage schema. Verify whether catalogue export is consumed; establish explicit REC/site/asset/capability IDs and preserve opaque source tags. Confirm interval versus cumulative energy before enabling unknown channels.
2. Add a versioned, bounded read contract with `site_id`, capability IDs, from/to timestamps, resolution/max-points and cursor pagination; provide latest values with timestamp, unit and data quality. Expose unavailable mappings explicitly.
3. Query indexed data at the database, aggregate according to metric semantics, and compute community totals on aligned timestamps with missing-site coverage. Benchmark database time, serialization, response size and memory before claiming improvement.
4. Add incremental live delivery with a bounded per-client queue, filtering, timeouts and reconnect/catch-up deduplication. The sampling interval is expected sensor cadence, not a promise of delivery latency. Validate power, SoC and energy semantics independently.
5. Wire site/device/community charts to the same measurement contract, then remove the compatibility query path. Preserve old raw data, even if no migration is needed for inventory.
6. Migrate schema dependencies and Deploy/bundle/log functions independently; remove the old container only after consumers no longer reference its endpoints and replacement paths have been verified. Until then the old service is a compatibility dependency, not the source of the new inventory.

This audit made read-only API calls and documentation changes. It did not modify production, enable tags, subscribe to Rabbit, migrate data, delete records or implement the proposed replacement service. No throughput/latency benchmark was performed.

## Percepta/Mongo inspection and Deploy review — later update, 2026-10-11

This section supersedes the earlier proposal to make measurements a separate service. The user's preferred boundary is **the new Telemetry backend serves both the signal catalogue and Mongo measurement reads**, while **Percepta** (correct product name) continues writing measurements directly to Mongo. Catalogue configuration remains in its existing database; avoid a second editable source of units/tags in Mongo. Historic API paths containing `perceptor` are currently unchanged for compatibility.

### Authorized local cleanup

Deleted exactly `REC Revista 897d8b6541` (REC `d7a73a9b-15b4-4ea4-bafe-73ee76069e54`), its one site and grid meter, three associated user relationships and its manual manager grant. Reconciled Access; no active grant remains for those resources. Retained user records, Console Sandbox, DEMFLEX LivingLab and the old source code. A private recovery snapshot was saved outside Git at `/tmp/energaize-rec-revista-before-removal.json`. The current selector should show two communities. Earlier tables documenting three communities are snapshots before this cleanup.

### Mongo structure verified read-only

Connected directly using the existing backend connection settings. No Mongo writes, broker subscriptions, model switches or production configuration changes were made.

- `living_lab` contains four `building_R-H-0*` collections and a `schema` collection.
- `SaoMamede` has `building_SaoMamede`; the examined database had no `schema` collection.
- `i-charging_headquarters_3Phase` has its own building collection and `schema`.
- Building documents have `_id`, `timestamp`, `observations`, `forecasts`, `community` and `decisions`.
- Observations include keyed batteries, grid meters, PV panels, tariffs, charging sessions and EVs. For example, `observations.batteries.B01.SoC`, `observations.grid_meters.GR01.energy_in_total` and `observations.pv_panels.PV01.energy`.
- Some values are scalar numbers without an adjacent unit; tariff structures carry `measurement_unit`, `horizon_seconds` and `frequency_seconds`. Some objects include `generated`. Do not silently label all values as physically measured or infer units from names alone. Preserve missing fields and source quality.
- All six examined building collections already have a timestamp index. The old API's load-all-then-aggregate pattern remains problematic despite those indexes.
- Latest-by-timestamp query for LivingLab R-H-01 returned 2026-09-30 08:44:00 UTC; the HQ collection returned 2026-10-11 15:55:15 UTC at inspection. Three latest samples in each of these two collections were 15 seconds apart; this does not establish cadence for every source or signal. Earlier `_id`-ordered samples in the four LivingLab collections also ended on September 30.
- The connection's `hello` response had no replica-set name. Do not assume database change-stream infrastructure is ready.

The four historical LivingLab collections are not automatically equivalent to the 36 sites imported from Excel. Require explicit mapping. A raw Percepta tag is also not necessarily the same identifier as a normalized Mongo device key or nested field path.

### Recommended Telemetry extension — not yet implemented

Keep the current configuration endpoints. Add a Mongo repository/adapter inside the Telemetry service with explicit bindings: inventory site UUID → database/collection; capability UUID → device key/observation path, unit, timestamp/value semantics and provenance. Bindings should use configured source names, not accept arbitrary Mongo query objects from the browser. Percepta remains the primary measurement writer; do not introduce duplicate ingestion through Telemetry. Any later correction/backfill endpoint should be an explicit administrative operation with provenance, not a generic Mongo write API.

A proposed read contract covers source availability, known channels and units, latest values, bounded historical series, and community aggregates with contributor coverage. Return observation time separately from query time, data quality, missing values and truncation/cursor information. Avoid downloading entire site snapshots when a graph needs only one channel.

For the first live implementation, use indexed incremental Mongo reads through Telemetry, shared/cached across clients, then deliver deltas to the UI. This gives one consistent source for history and updates. Bound queries and handle timestamp ties, duplicates and late arrivals; do not repeatedly fetch full history. At the observed 15-second storage cadence, this is a reasonable starting design, not a measured performance guarantee. If subsecond delivery or scale requires it, Telemetry may consume the existing Rabbit stream and serve WebSocket/SSE, with matching identities and storage reconciliation. Compare actual latency/load before declaring either option superior. No Rabbit is reintroduced between the four domain services.

Schemas are stored at `<database>.schema`, document `_id = "schema"`, nested `schema` value. The LivingLab schema contains buildings, EVs and CityLearn-style simulation fields (device classes, autosizing, weather/pricing paths, observations/actions). A future versioned domain-to-schema exporter should compose Community structure + Telemetry signal bindings + simulator/algorithm-specific configuration, expose missing fields, and generate a reproducible snapshot. Community can expose the inventory export; simulator/execution code should own target-format transformation. Mongo stores the exported snapshot if needed. This is planned work, not a completed endpoint or a lossless migration claim.

### What Deploy actually does

The old API does not train models or build/deploy Docker images. It accepts a folder containing an `artifact_manifest.json` plus trained model/policy files; hashes file contents into a bundle ID; stores files on a shared filesystem and metadata in a JSON index. It lists preconfigured inference targets and checks their HTTP health. Switching a model calls the selected target's `/admin/load` with the manifest/artifact paths, relying on an already-existing shared volume. It then reads the target's health. Logs are Docker stdout/stderr from the configured local container, exposed as a live text stream or paged historical response. These are execution features, not sensor telemetry, so they should eventually be owned by the execution/deployment service.

Positive implementation details: relative file paths are validated against directory traversal, file preview is bounded, the JSON index uses a lock and atomic replace, remote HTTP calls have timeouts, and deletion checks known active targets. These checks do not resolve the defects below.

Concrete findings in `opeva_backend_api_training/app/services/deploy_service.py`:

| Finding | Evidence and effect | Recommended correction |
| --- | --- | --- |
| Upload can replace an active bundle | `upload_bundle_folder` matches folder name, removes the destination and copies new content without checking running targets; a same-name upload changes an existing bundle ID and discards the old version | Store immutable content-addressed versions; stage and atomically publish files; retain rollback versions and protect active references |
| Switching reports success without confirming activation | `switch_inference_bundle` returns `status: switched` after a successful HTTP response even when the following health says unhealthy or points at a different manifest | Verify requested identity and health, distinguish accepted/loading/active/failed/unknown, and preserve or restore the previous version |
| Offline target does not protect active files | `delete_bundle` skips unreachable targets and can delete a bundle still used by one | Track assignments durably and refuse deletion while usage is unknown; coordinate upload/switch/delete |
| Invalid manifests are accepted | Upload checks only that `artifact_manifest.json` exists, not that it is valid JSON or references usable artifacts | Validate manifest schema, referenced files and compatibility before publication; enforce size/file-count limits |
| Historical logs load the full requested window before pagination | `fetch_inference_logs_history_chunk` asks Docker for `tail=all`, decodes/parses all lines and only then slices a page; repeated pages reread that window | Bound time/bytes and use an indexed log store or cached immutable window with proper cursors |

Validation: all 10 existing Deploy API tests passed in an isolated temporary environment. Four additional local reproductions confirmed active same-name overwrite, false switch success, deletion with an unreachable target, and invalid-manifest acceptance. These reproductions assert the observed faulty behavior; their passing result is evidence of the defects, not acceptance tests proving correctness. Temporary test file: `/tmp/test_energaize_deploy_review.py`; targets and files were mocked/temporary. Production models and the old repository implementation remain unchanged. A broader security or concurrency audit was not performed.

## Implemented Telemetry measurement adapter (2026-10-11)

This implementation supersedes earlier notes that measurements were only planned. The new console's active measurement requests now use `/telemetry-api/api/measurements`; its old historical fetch and site-source editor were replaced. Legacy React source and its compatibility proxy remain as references; Deploy is unchanged. Percepta writes directly to Mongo and was not modified.

### Delivered API

- `GET /api/measurements/sources`: configured database/collection discovery, with an explicit database allowlist.
- `GET /api/measurements/sources/{database}/{collection}/fields`: scalar field discovery from the latest stored document, including observed type, value and source-generated flags. It is not an exhaustive historical field catalogue; absent fields and arrays remain available in the raw snapshot.
- `GET /api/measurements/sources/{database}/{collection}/latest`: full latest source document, preserving nested observations, forecasts, community and decisions.
- `GET /api/measurements/sources/{database}/schema`: existing Mongo schema snapshot, not a newly generated domain export.
- `GET /api/measurements/sources/{database}/{collection}/series?field=...&from_ts=...&until_ts=...`: source preview without an inferred unit or asset association.
- `PUT/DELETE /api/measurements/capabilities/{id}/binding`: explicit per-capability source association, independent of the original external tag. The binding stores database, collection, field path and optional note in the existing capability details JSON.
- `GET /api/measurements/capabilities/{id}/latest` and `/series`: normalized sensor values using catalogue units and only explicitly configured conversions; latest includes observation age and a stale indicator when expected cadence is known.
- `GET /api/measurements/sites/{id}/channels` and `/assets/{id}/channels`: domain discovery, including unbound sensors. These look up the current Telemetry profiles; they are not inventory existence/authorization checks.

Series require timezone-aware from/until timestamps, with an exclusive end, a maximum 31-day window and at most 1,000 samples per page. They return stable `(timestamp, ObjectId)` cursors tied to the exact source/window, truncation status, units/semantics, and quality/generated flags. Missing/non-scalar/non-finite values are not turned into zero. Read-only queries project the requested field and quality markers, use database timeouts and a bounded connection pool. Latest-document reads have a 5-second bounded cache. Current cursor support is for ObjectId-backed Percepta documents, as verified in the examined sources.

The existing single-field timestamp index is used for latest reads. An initial two-field latest sort was slow against this index and was replaced; no index or other Mongo data was modified. Historical ordering retains timestamp and ObjectId for stable pagination over bounded windows. A one-hour source query returned 241 records in approximately 325 ms in one local-to-server trial. This is not a throughput or concurrent-load benchmark.

The default local allowlist is configured privately for `living_lab`, `SaoMamede`, and `i-charging_headquarters_3Phase` (six site collections). Other databases are not silently enabled or treated as RECs. Different storage layouts need an explicit adapter/binding and configuration; this does not claim automatic semantic understanding of every Mongo database.

### UI and demonstration

Site/member overviews and equipment measurement views share the React/Recharts plotting surface with Jobs (`TimeseriesPlot`) and use the same calendar library. There is now one Vite build entry (`index.html`). The existing domain view modules under `public/console/` are compiled into a workspace module, mounted by `CommunityWorkspace` inside React. An open Shadow DOM isolates workspace CSS while these views migrate to React components; it is not an iframe or a separate page. Requests, listeners, timers and chart roots are disposed when leaving the workspace.

Controls include 1h/6h/24h/7d/30d presets, previous/next window, calendar and exact local dates/times, pointer tooltips, drag-to-zoom, latest stored window, refresh and Live. Fresh bound sources enter Live automatically; old sources open their latest stored window explicitly labelled Historical. Source linking and notes are secondary controls below the plot. The moving x-axis evicts old points while preserving history in the selected window. There is no Rabbit subscription.

Short windows follow every raw cursor with an unchanged exclusive end, deduplicate records and reject incomplete/cyclic pagination. Long windows (over 6h, or after 20 raw pages) use `/chart`, capped at 1,200 plotted points by default. This indexed Mongo aggregation projects only one selected field, groups bounded time buckets and retains first, last, minimum, maximum and a missing observation per bucket. Extrema are actual stored samples, not interpolated averages or energy totals. It returns the source sample count and generated count. Raw `/series` remains the contract for calculations; the visual envelope must not be used for KPIs or integration of energy.

Live requests only the recent tail, using the previous query end with a 30-second overlap, deduplicates by ID, trims expired data and bounds rendered points. Hidden tabs pause polling; reopening catches up. Leaving a route or changing sensor cancels pending requests and cleans up polling. Refresh errors are shown without pretending the displayed values are fresh. A write can wait up to approximately one polling interval (15s) plus request latency before appearing. Arrivals older than the overlap require a full refresh; this is not guaranteed delivery or a full reconciliation protocol.

Managers can open Measurement explorer from the community overview or administration. It previews numeric source fields without assigning them to sites. Equipment/site charts expose source linking and unlinking, checked against Access before writes; the general test-environment authentication limitation remains.

With explicit user approval, Demo Home in Console Sandbox has one additional sensor `percepta_import_demo` bound to `living_lab / building_R-H-01 / observations.grid_meters.GR01.energy_in_total`. It is labelled **DEMONSTRATION — historical R-H-01, not measurements from Demo Home**. Unit and interval/cumulative meaning are deliberately unconfirmed. The original catalogue tags and the real LivingLab site mappings were not changed. Generated flags from Mongo remain visible in the chart. The channel stays disabled for Percepta ingestion; binding an existing stored series is independent of enabling collection.

### Validation and remaining work

- Full backend suite: 660 tests passed. Telemetry subset: 130 tests, including 20 new measurement cases for pagination/query limits, invalid paths, missing values, units/conversion, persistence and source failures.
- Real Mongo read-through: discovery, latest snapshot, schema, bound series and consecutive cursor pages verified; pages had no overlapping sample IDs.
- Binding persisted through the existing PostgreSQL capability mapper and a Telemetry container rebuild.
- UI build passed; 7 classic console tests and 41 targeted React/data/route/ownership/Jobs-granularity tests passed, including cursor traversal, cancellation, rolling-window eviction, extrema and missing values, and the 15-second polling lifecycle. Browser checks exercised manager source exploration, the Sandbox historical plot, the resident site chart, and the moving refresh window. The real four-backend integration check now queries Telemetry instead of the old measurement API and passed.
- Infrastructure compose accepts the private Mongo settings for a future Telemetry image. No image was pushed and no remote stack was deployed.

Consumers can now use the documented Telemetry contract for raw data, including KPI services. External KPI/calculation services were not migrated during this change. Community-level aligned aggregation, metric-aware statistical/energy rollups, late-arrival reconciliation beyond the small UI overlap, production authentication, binding coverage for real sites, definitive units/value semantics and the future Percepta configuration handshake remain separate work. This delivery centralizes the active console measurement path and provides the backend contract; it is not a claim that all existing consumers have already switched.


### Chart performance validation (2026-10-11)

A read-only check on the approved R-H-01 demonstration compared the full day (5,760 raw records over six pages) against its 795-point visual envelope. Every plotted record existed in the raw results, global minimum and maximum matched, and no raw IDs overlapped between pages. One local-to-server trial returned the daily envelope in 0.135s (approximately 100KB) and a 30-day requested window in 0.762s (approximately 59KB). The full six raw pages took 0.864s in a separate trial. These are individual measured requests, not concurrency benchmarks, and a requested 30-day window does not imply uninterrupted data coverage.


### Calendar and Live continuity correction (2026-10-11)

The selector now groups the channels explicitly bound to stored data separately from configured-only channels. Demo Home has nine catalogue sensors but only one historical demonstration binding; a catalogue channel is not evidence that readings exist in Mongo.

Calendar day selection starts a new range on the first click and completes it on the second. The end day is included by sending an exclusive timestamp at the following local midnight. Manual date/time inputs update the calendar highlight too. The calendar CSS isolates its day grid from global inventory table rules, fixing overflow and invisible selected-day text.

Live retains an out-of-date historical plot while the current window has no readings, with a visible explanation that the displayed history is old and polling is checking now. Once current readings appear, the rolling current-time plot is shown. For a current window, a dashed reference line marks the time Live was activated. An old September plot is never relabelled as current or stretched across an eleven-day gap. Changing the historical period while viewing retained history leaves Live; turning it off preserves that historical window.

Validation: 12 measurement React/data tests and seven console tests passed; build passed. Added tests cover two-click full-day selection, incomplete-range rejection, retained history while waiting, transition on resumed readings and the Live boundary. Browser checks verified calendar layout, highlighted days and historical continuity.

A separate single-request comparison for the same hour (2026-09-30 07:44–08:44 UTC) measured the legacy community-wide historical endpoint at 0.495s / 1,119,917 bytes and the current single-sensor Telemetry endpoint at 0.065s / 30,559 bytes. These are different payload scopes by design and different service placements, not a controlled throughput benchmark or a reconstruction of the frontend's earlier wall-clock loading time. No Mongo records or sensor bindings were changed in this correction.


### Multi-series measurement pills (2026-10-11)

The site/equipment workspace now uses toggle pills for linked sensors instead of a single-choice selector. By default it opens up to two linked power import/export channels with matching units, or the first linked channel when no preferred power channel exists. Unlinked catalogue sensors remain accessible under Configure sensors, including their existing binding actions; no new bindings or Mongo data were created for this UI change.

Selected channels share the exact historical window, calendar and Live state. Same-unit curves overlay in one plot; incompatible or unconfirmed units receive separate aligned plots with common time controls. Deselecting all channels stops measurement reads and shows a selection prompt. Selecting/deselecting a channel reloads only the active set without resetting the chosen period or Live. Requests run in small batches, each series handles its own cursor pagination, IDs are namespaced by capability so readings from the same Mongo document do not overwrite one another, and Live compaction preserves each series' extrema independently. A failed source is reported individually while successful series remain visible.

Validation: dedicated multi-channel data tests cover defaults, selected-only fetching, document identity collisions, partial failures and per-channel extrema. The workspace interaction test verifies toggling, time-window preservation and unit separation. Browser validation used a temporary, clearly labelled synthetic fixture to render two overlaid W curves and a separate % curve, then returned to the real Sandbox and removed the fixture. The Sandbox itself still has only one mapped series, so one linked-data pill is expected there.

## Channel configuration and replacement audit — 2026-10-11

### Equipment, reference, channel and reading

A channel describes one quantity of an equipment item. An external tag may identify a scalar or a multi-field response; an external device reference needs a field/parameter selector. Multiple channels may share a namespace/reference, and one asset may use several providers. `tag` remains an opaque string, preserving numeric leading zeroes. `external_device_id` and `source_field` represent the device/field form. `source_kind` declares unconfirmed, physical, simulated, derived or historical origin. This declaration does not verify data quality or create a collector.

The Console edits configuration through Community's asset-scoped `POST /api/assets/{asset_id}/signals` and `PUT /api/assets/{asset_id}/signals/{channel_id}`. Community checks that the asset exists and the channel belongs to it. **Transitional storage:** profiles/capabilities still reside in Telemetry's PostgreSQL catalogue. These routes delegate writes; they are not a completed migration of catalogue persistence into Community. Measurement queries remain in Telemetry. Mongo bindings are separate from collection references.

The editor exposes display name, origin, provider namespace, external tag/device, source field, unit, expected interval and value meaning. Commands remain distinct. The graph uses human-readable channel names and puts source provenance outside the name. Graph pills select channels, not providers or physical devices.

### Configured local example

`node scripts/configureSandboxChannels.mjs --apply` configures only `Console Sandbox / Demo Home` using localhost APIs, preserving unrelated inventory and all Mongo data. It is safe to rerun for this fixture.

- Battery / State of charge: %, `battery-simulator / battery-01 / state_of_charge`.
- Battery / Power: kW, the same provider and device, field `power`.
- Battery / Temperature: °C, separate `thermal-simulator` provider and scalar tag `battery-01.temperature`.
- Each generated channel has a 15-second interval and explicit sine-wave parameters. The channels are independent UI/configuration fixtures, not a physically coherent battery simulation.
- The original Grid meter archive now displays `Grid import`. Its historical R-H-01 provenance and unconfirmed unit/semantics remain explicit. No real readings were relabelled as observations from Demo Home.

`simulation_binding` is opt-in and mutually exclusive with `mongo_binding`. It produces deterministic generated readings on request through the same latest/series/chart APIs, with bounded pages and channel/window/configuration-specific cursors. Samples before the configured start and future readings are excluded. Long windows retain sampled extrema with bounded response size. Generated values are not persisted to Mongo and never substitute for unavailable physical data. Local generators are excluded from Percepta's collection export; externally hosted simulated sources without a local generator remain valid collection configurations. Turning off a local generator removes its readings from the chart until another source is linked; it does not restore a previous Mongo binding automatically.

### What the new backend/UI does and does not replace

This is a source-code/API audit plus local targeted checks, not a claim of complete production parity.

| Area | Previous implementation | Current active Console / new services |
| --- | --- | --- |
| Inventory discovery | Legacy API listed Mongo databases and schemas. | Domain Community inventory, ownership and type-specific equipment. Deliberately does not auto-import every old Mongo community. |
| Historical measurements | Whole-document historical responses consumed by legacy GraphicsView. | Explicit channel reads, bounded paging/chart envelopes, multiple pills, unit-separated plots, calendar and 15-second Live refresh. Real-site mapping coverage is incomplete. |
| Live delivery | `/ws/data` relayed Rabbit messages. | Polling the measurement source through Telemetry. No equivalent Rabbit/WebSocket stream in the new path. |
| Community totals and prices | Legacy GraphicsView had community consumption/production and pricing series, plus battery/EV/charger mappers. | Community views now include explicit aligned power totals, contract component prices, batteries, EV chargers and owned EV channels. Totals require configured power semantics; unknown-unit historical counters are not silently converted into power/energy. |
| Geographic map | Legacy Leaflet community map with geographic layers. | Inventory list and conceptual equipment topology. Geographic map is deliberately excluded at the user’s request. |
| Community/site/equipment editing | Old screens and schema forms had mixed real API/prototype behaviours. | Community/site creation and settings, equipment creation for all 13 asset types, full schema-backed technical forms and channel configuration save through the APIs. |
| Contracts | Legacy schema content could contain prices/contracts. | REC contract versions, per-site overrides and comparison contracts are editable in the Console. Fixed/indexed/relative component curves are supported; no billing engine intended. |
| Ownership/accounts | Legacy UI used demo role/session data. | Community associations and Access permission checks support manager/resident views and site ownership inheritance. Authentication remains deliberately mocked; this is not a production authorization review. |
| Flexibility | Previous ProsumerFlexibilityPage was local React state; Save preferences had no persistence handler. | Active Console creates, edits and cancels persisted EV, appliance, heat pump, heater and water pump sessions. Cancellation uses the existing DELETE API; execution and cancellation history are not implied. |
| KPIs, alerts and logs | Some old dashboards/logs were illustrative data (`getEnergyLogs`), not operational services. | Community insights/benchmarks and a real activity/alert feed remain incomplete. Separate KPI-manager application is not migrated by this work. |
| Schemas | Old API created/updated/read Mongo schema snapshots. | Telemetry can read an existing legacy snapshot. Generating schemas from Community and replacing old schema create/update are pending. |
| Algorithms and deploy | Old deployment API handles bundles, inference targets, health, bundle switching and logs. | Preserved in the old backend by prior request. New Console cannot assign/switch a site's running control model yet. |
| Percepta integration | Existing per-provider configuration files. | Community exports channel configuration, but Percepta is not yet modified to consume it automatically. |

The previously measured 0.50 s / 1.12 MB versus 0.065 s / 31 KB comparison was a single same-hour API experiment. It demonstrates the benefit of narrower measurement queries, not a full-page or system-wide performance guarantee. The Console still loads the full registry and performs several permission checks during login; this has not been scaled/benchmarked for large communities.

All legacy source remains available. Deploy/inference services and production Mongo were not changed. Current changes are local; publication and deployment of these updates have not been verified in this iteration.


## Connected operations — 2026-10-11

Scope: inventory, contracts, flexibility and community chart parity. Geographic maps are excluded. Legacy source and deploy functionality remain intact; this iteration is local and has not been committed or published.

Inventory forms use the running API OpenAPI schemas. Nested technical characteristics, arrays and optional objects are editable without JSON. Wind curves support paired wind-speed/power points; stored curve wrappers are normalized to the request format. SOC fields display percentages and serialize fractions. Site type/subtype options come from the Community vocabulary endpoint. A new site stays in the selected REC. Equipment creation in a site inherits that site association; EVs use explicit ownership instead. Creation can precede asynchronous catalogue provisioning by a few seconds; refresh before adding channels if a profile is not ready.

Contracts preserve version IDs when edited. REC operational rules, site conditions and site comparison contracts have separate editors. Graphs display individual contract price components and apply fixed, indexed and relative rules, including the 0.8 member-sale multiplier. Indexed sources require a configured, enabled Telemetry channel normalized to EUR/kWh. All reading access goes through Telemetry; the UI computes contract curves from those readings. This is not a price-calculation API for external KPI consumers. Time-of-use curves are labelled by period and are not presented as a resolved tariff calendar or bill. Indexed histories follow cursor pages with a 50-page guard, asking for a shorter window rather than truncating silently.

REC `measurement_groups` persist explicit sets of non-overlapping channels (up to 32/group, 12 groups). `price_sources` maps contract source names to capability IDs. Telemetry `/api/measurements/totals/{series,chart,latest}` computes power totals in kW from enabled, instantaneous W/kW/MW channels. Mongo performs bounded server-side means in aligned bins; simulation uses an analytic mean of sampled values. The API sums aligned means, not min/max envelopes. Missing contributors and invalid conversions produce gaps. It rejects duplicate IDs and duplicate stored fields. It cannot infer whether different physical meters overlap electrically; the operator must select the correct boundaries. Counter conversion, energy integration and billing are not claimed. Responses include bin size and contributor counts. Aggregated live charts re-read their bounded window to avoid combining partial buckets of different resolutions.

The manager has Contracts and Flexibility in the top navigation. Residents only see sessions whose assets and related EV/charger references are accessible to them. Changes recheck Access permission before writes. EV minimum departure SOC is required; arrival SOC is optional. Other forms use their respective duration/profile/setpoint constraints. Sessions are saved requirements, not evidence that an algorithm accepted or executed them. Authentication remains the agreed test mode.

`node scripts/configureSandboxOperations.mjs --apply` extends only the existing local Console Sandbox with clearly simulated PV, charger, EV, grid power and price signals. It retains the existing archived Mongo channel and battery examples. It also configures power totals and an explicitly named Sandbox tariff. Signal fixtures are independent demonstrations, not a physically consistent energy simulation. No new readings are written to Mongo.

`node scripts/checkConsoleOperations.mjs` creates disposable local fixtures, exercises schema-form serialization through the running APIs for all 13 asset types, REC contract rules, site overrides and all five flexibility session types, then removes those fixtures. Unit tests cover SOC conversion, null/empty PATCH handling, typed selections, nested contract IDs, relative pricing, dates, aligned totals, missing contributors, duplicate sources and overflow. Browser verification additionally covers a resident EV session create/edit/cancel cycle, contract save, community totals/prices and inventory dialogs.

### Visual refresh (11 October 2026)

The Console now reuses the Jobs `AuthBackdrop` and `EVChargingLoader` components. Authentication keeps the existing backend-connected test accounts; background rotation can be paused and respects reduced motion. Loading reflects actual backend work, without an artificial delay. The visual layer lives in `src/console/presentation.css`: translucent navigation and overlays, consistent controls, clearer tables and forms, and responsive manager/resident views. The top navigation and existing operations remain in place.

Browser review covered manager/resident sign-in, invalid credentials, community selection, overview readings, settings and logout. During resident verification, a connected EV without a legacy `payload` exposed a catalogue crash; normalization now accepts both shapes, preserves explicit ownership and removes duplicates.

Validation: production build passed; 20 classic Console tests and 47 focused React/domain/routing tests passed. The full React suite has 167 passing tests and five existing integration failures (four obsolete community-route expectations, one Jobs KPI comparison selector), plus two unhandled API-mock errors associated with the old routes. An isolated copy using the pre-refresh login/loader/styles reproduced those same five failures and mock errors. The full suite is therefore not green.

### Unified application (11 October 2026)

The earlier standalone-login description above is historical. There is now one React entry point, router and `AuthProvider` for every workspace. `LoginPage` is the original Jobs form, including field icons, password visibility, remember-me, test-account selection, theme and authentication animation. Managers open `/communities`; residents open `/app/community/dashboard`; training roles open `/app/ai/jobs`.

`CommunityWorkspace` mounts the domain views within the same document. The Vite workspace module is compiled normally (no runtime evaluation or injected scripts). Style isolation uses an open Shadow DOM, with the shared `UserMenu` rendered through a React portal so it retains the same auth/router context. Community profile edits on the common Account page persist to Community before updating the shared session. Legacy console URLs redirect to `/communities`; they no longer expose their own form or session. The obsolete standalone chart/presentation entry modules have been removed. `UIProvider` no longer calls the legacy measurement backend to obtain REC/member inventory.

Verified in the browser: original login → REC Manager selection → overview with Telemetry; common profile and logout; original login → resident home → equipment details; original login → Jobs, all on port 5177. Automated tests now exercise the integrated manager/resident routes, persisted community creation, ownership scope, shared logout, backend identity resolution and cleanup of workspace listeners/timers/requests. The full React suite passes 177 tests with one previously existing Jobs KPI comparison-selector failure; the 20 workspace model/transport tests pass. Production build has one HTML entry.

## First test deployment review — 2026-10-11

The login is shared across the original Jobs application and both community roles. REC Manager/Prosumer identity and active manager grants are read from Community/Access; passwords and the browser session remain test mechanisms. Jobs/predictor/KPI fixtures are unchanged. The legacy backend is still used by Deploy and existing non-community areas, not by the new community inventory or measurement workspace.

Working scope: community/site/13-type asset inventory and technical forms; generic channels/tags and explicit measurement bindings; ownership inherited from sites plus separate EV ownership; community rule versions and site overrides/comparison contracts; five flexibility session types; charts/history/live polling and explicitly configured community totals. Percepta writes Mongo; Telemetry reads it. Simulated channels are explicitly labelled. KPI/benchmark calculations, real device dispatch, algorithm assignment and a domain-to-simulator schema exporter remain unfinished.

Flexibility persists `asset_id` and optional EV/charger references. The UI uses Access decisions and filters resources through ownership. There is no separate session creator/user field, no execution acknowledgment and no server-authenticated caller enforcement on the session endpoints. Cancellation currently deletes the saved request. These are deliberate test-environment limitations, not claims of production isolation or an execution/audit workflow.

Presentation: refined translucent navigation, menus and inspectors; simplified overview counts; quieter tables, rounded controls and short menu/drawer transitions. Reduced-motion and reduced-transparency preferences are supported. Data surfaces retain solid contrast. Browser review covered overview and the contract drawer.

Release preparation: all UI tests now run before publication; images have a commit-SHA tag as well as main's `latest`. Updated the obsolete Jobs comparison test to check the current two-job reference/candidate view instead of removed ID column headings. Docker proxies accept startup API URLs and work with the infrastructure's internal service names; legacy path redirects preserve the public port. Use a pinned UI SHA during the first coordinated rollout because the existing UI infrastructure has Watchtower for `latest`.

Validation: 178 React tests, 20 classic workspace tests, production build and Docker build passed. Backend unit/domain/router suite: 683 passed. The running local APIs also passed form round-trips for all 13 equipment types, contracts/site overrides and five session types, plus ownership grant/revocation, tags, Mongo source discovery and cursor pagination. The release container served routes and all four API proxies. Credentials and local `.env` files are excluded from commits. Server-specific Mongo credentials, inventory/mappings and the selected image versions must be installed separately; an image does not copy local database contents.
