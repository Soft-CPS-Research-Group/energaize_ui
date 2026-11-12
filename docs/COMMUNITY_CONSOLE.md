# Community Console

The REC Manager and consumer workspaces run inside the same React application as
the AI, predictor and KPI areas. They share authentication, profile photos, account
controls and the institutional footer. For setup, see [development](development.md).

## Navigation and access

REC Managers select a community and inspect its homes, equipment, contracts,
flexibility and deployment settings. Consumers see their accessible homes and
equipment, including a vehicle garage and flexibility requests. Site selection
does not grant ownership of a vehicle; equipment access is checked separately.

Community stores inventory and relationships. Access Control supplies grants and
authorization decisions. The backend authorizes requests; hiding a control in the
browser is not an authorization boundary.

The main routes are `/communities` and `/app/community/*`. `CommunityWorkspace`
mounts the community view modules compiled by `config/communityRuntime.ts` and
adds React components for measurements, calendars and deployment. Its Shadow DOM
isolates community styles. `public/console/` remains active application code.

## Inventory and equipment

Community, site and equipment forms save through the relevant backend and refresh
the displayed data after success. Equipment includes meters, PV, batteries,
chargers, vehicles and appliances. Repeated equipment types are grouped in the
overview, with individual items available from that group. The equipment view
offers topology and list navigation; equipment detail exposes its measurements
and configuration.

Site settings include identity, location, grid connection, limits and contracts.
The deployment view shows the associated machine and service placement. A machine
association is distinct from observed connectivity or a running service.

Inventory changes can leave configuration reviews for dependent services.
Recording a review confirmation does not itself deploy those services. Versioned
editors retain unsaved input when a concurrent change is detected; see
[concurrent editing](concurrent-editing.md).

## Measurements and charts

Telemetry owns channel profiles, units and stored-reading bindings. Percepta writes
observations to MongoDB; the UI reads them through `/telemetry-api/api/measurements`.
Binding a channel identifies its database, collection and field explicitly. Tags
and inventory IDs alone do not establish that mapping.

Site and equipment charts share the React plotting components. They offer time
windows, calendar selection, zoom, refresh and Live mode. Missing values remain
missing; energy and power retain their configured units. Source-generated markers
are preserved. Live mode polls stored readings rather than subscribing to RabbitMQ.
Refresh failures and historical data must remain distinguishable from fresh data.

The Measurement explorer previews authorized sources without assigning them to a
site. Linking or unlinking a stored-reading source is a separate configuration
operation. Source availability, an enabled collection channel and a valid
measurement binding describe different states.

Long-window charts can use downsampled visual envelopes. Use the backend's raw
series contract for calculations; plotted envelopes are not an energy integral or
a KPI calculation API. The legacy `/measurement-api` proxy remains for compatible
views and must not be confused with inventory or the Telemetry catalogue.

## Flexibility

The calendar presents saved equipment requests and prediction information, with
equipment filters, recurring and one-off windows, request history and constraint
editors. The Flexibility backend owns persistence and source-selection semantics.
See its contracts before changing recurrence, cancellation or selection behavior.

An availability request or forecast is not evidence of physical execution.
Managers' visibility of requests does not imply permission to create requests on
another person's behalf. Errors, overlapping requests and missing community
associations have explicit UI states.

## Deployment

Open a house's **Deployment** tab to inspect the service plan and runtime state.
Percepta, inference and forecasting can be placed on the server or the house's
associated machine where the backend permits it. Drafts and review describe
proposed placement; observed instances describe runtime state. Saving a plan does
not start its services.

Percepta's service manager provides source, equipment measurement and actuator
definition editors. Saving an actuator definition does not send an equipment
command. Configuration editing, generation and runtime actions are distinct
operations. Apply changes through the available service controls and review their
reported results. Bundle launch remains unavailable in the planning workspace.

### Percepta messages

REC Manager → community → house → **Deployment** → **Percepta messages** opens the
last 30 persisted output messages. The viewer refreshes every five seconds and
supports pause, search, pinned selection, section/JSON views, copy and download.

It reads `/runtime-api/api/runtime/percepta/sites/{site_id}/messages`. The backend
resolves the source from the authorized site, using its `percepta-mongo` external
reference or applied configuration. The browser does not select a database or
receive broker credentials.

For the Matisse configuration, the mapped presentation sites are RH01–RH04 and
i-charging HQ. Their current receipt status must be checked in the viewer; a
previous successful check does not establish continued delivery.

The message timestamp belongs to the stored Percepta output. A successful refresh
does not prove that every measurement is valid or that inference consumed it.
No-source, empty, stale and failed states are separate. The viewer does not consume
queues, start collectors or change deployment settings.

## Related documentation

- [Activity](activity.md): account-adjacent timeline and configuration review scope.
- [Concurrent editing](concurrent-editing.md): retained drafts and version conflicts.
- [Backend reference](https://github.com/Soft-CPS-Research-Group/bounded-context-be/tree/main/docs/backend-reference):
  Community, Access, Telemetry, Flexibility and Runtime contracts.
- [Percepta integration](https://github.com/Soft-CPS-Research-Group/bounded-context-be/tree/main/docs/percepta):
  collection configuration, health and runtime behavior.
