# Concurrent editing

Versioned editors keep the version returned with the data shown when the form
opens. Updates send that value as `expected_version`; they do not fetch a newer
version merely to make an old draft save successfully.

## Covered editors

- Site identity, location and technical settings.
- Site reference contracts and community-condition overrides; the version belongs
  to the site.
- Equipment characteristics; the version comes from the asset response envelope
  alongside `data`.
- Channel settings, including Percepta measurement and actuator definitions for
  equipment, site and community channels.
- Stored-reading bindings and unlink operations. These Telemetry endpoints accept
  `expected_version` in the query string, preserving the existing binding body.

## Conflict behavior

When the backend reports a conflict, the form keeps the draft visible and blocks
repeated submission. **Discard edits and reload** explicitly abandons that draft
and loads current data. The user then reopens the editor to review it. There is no
automatic merge or force-save.

A batch of channel changes can partially succeed because each save is a separate
request. The error reports how many changes were saved.

## Contract boundaries

Creation requests do not send an update version. Community records, connection
profiles and runtime settings have separate contracts. This mechanism does not
add version fields to those contracts.

An older backend response without a version cannot provide this stale-form
protection. Backend and frontend support must both be present for versioned edits.

## Maintenance

Regression tests cover original-version capture, conflict metadata, retained
drafts, explicit reload, asset envelope mapping and the React Percepta editor.
Backend tests cover forwarding and conflict responses for binding operations.
See [development checks](development.md#checks) for the frontend commands.
