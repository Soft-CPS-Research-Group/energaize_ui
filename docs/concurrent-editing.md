# Concurrent editing

Site, equipment and channel editors keep the version returned with the data shown when the form opens. Updates send it as `expected_version`; they never fetch a newer version merely to make an old draft save successfully.

Covered paths:

- Site identity, location and technical settings.
- Site reference contracts and community-condition overrides (the version belongs to the site).
- Equipment characteristics; the version comes from the asset response envelope, alongside `data`.
- Channel settings, including Percepta measurements and actuator definitions for equipment/site/community channels.
- Stored-reading bindings and unlink operations. Telemetry accepts `expected_version` in the query string on these two endpoints, preserving the existing binding body.

On a conflict, the form keeps the draft visible and blocks repeated submission. “Discard edits and reload” explicitly abandons the draft and loads the latest data. The user opens the editor again to review it. There is no automatic merge or force-save. A batch of channels can partially succeed; the error reports how many were saved.

Creation requests do not send an update version. Community records, connection profiles and runtime settings have separate contracts; this change does not introduce version fields into those contracts. Older backend responses without a version remain usable but cannot provide this additional stale-form protection. Deploy the updated backend and UI together to enable it fully.

Validation includes original-version capture despite a background model change, conflict metadata, draft retention, absence of automatic retry, explicit reload, asset envelope mapping, and the React Percepta editor. Backend tests cover version forwarding and conflict responses on binding/unbinding.
