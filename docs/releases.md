# Releases

## 0.3.1 — 2026-10-23

Job submission keeps the same identity while a response is uncertain, including
retry after page reload. Acknowledging a successful submission starts a fresh
identity for the next run. Keys are separated by account and workspace.
Validated by retry/reload tests and the production build.

## 0.4.0 — 2026-10-23

Job details show frozen config/dataset versions, exported house IDs and community
scope, and link registered candidates to their source experiment. Managers can
register verified finished candidates directly from the job. Failed/canceled jobs
and unverified community exports cannot be presented as ready candidates. Previous
attempt exports remain visible without preventing registration of a new export.
# 0.4.1 — live job detail (2026-10-23)

The open job detail polls status, metadata and progress while work is active,
then refreshes the final result when it finishes, fails or is canceled. It stops
polling after a terminal status. Integration tests exercise those transitions
without a page reload.


## Concurrent editing follow-up

Inventory and channel editors now send the version originally read and retain unsaved input on conflicts. Site contract edits and Percepta channel configuration use the same protection. Reloading after a conflict is an explicit user action. See [concurrent editing](concurrent-editing.md) for coverage and deployment compatibility.

## 0.4.2 — prompt result availability (2026-10-25)

Job overview renders without waiting for optional progress or result files. The
simulation index loads only when a results tab is opened, after result metadata
arrives. An explicit `simulation_data_available: false` skips the index request
and shows an empty state immediately. Inline KPIs and deployment bundles remain
available independently of simulation CSVs. Jobs without the availability field
still query the index; a missing directory is empty, while access/server failures
remain errors instead of silently falling back to example data.

Regression coverage includes delayed results, absent simulation files, inline
KPIs, bundles without CSVs, older metadata, index failures and live job completion.
# 26 October 2026 — local machine association

REC Managers can read the machine associated with each house in Overview and
Settings: name, hardware, memory and deployment-registration status. A house with
no machine and an associated machine awaiting connection have distinct states.
The display does not equate registration with online status or running services.
It reads the existing scoped deployment-plan API without changing associations,
service placement, source addresses or launch behavior. Request failures are
explicit and previous-house responses cannot replace the current house's display.

## 28 October 2026 — deployment planning workspace

House Deployment now separates the editable plan from observed runtime instances.
REC Managers can drag Percepta, inference and forecasting between the central
server and the associated machine, or choose a destination in a component dialog.
Internal arrows stay inside their host. Compact connection labels open an editor
with automatic suggestions or a host/port override. Forecasting's direct data
exchange remains explicitly proposed; inference shows HTTP request/response.

Drafts persist through the new scoped runtime `deployment-draft` API, with revision
conflicts preserving unsaved edits. Review shows current versus proposed placement
and pending delivery requirements. Saving never changes the launch policy or running
containers. Bundle launch remains unavailable while its final service contracts and
launcher are pending. Existing configuration and runtime controls remain reachable
under In operation. Machine observations retain the last result and timestamp;
checks run on request, with no expiry timer in the UI.
