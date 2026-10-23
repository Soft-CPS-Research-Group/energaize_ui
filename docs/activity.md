# Activity beside the account

The Community workspace exposes a small history icon immediately before the account control. It is available to REC Managers and prosumers; it is not a primary-navigation item. A centered modal provides period/type filters, context scoping and a progressively loaded timeline.

## Data and access

`GET /community-api/api/identity/activity` uses the existing signed-in session. The backend applies authorization before pagination. The manager sees permitted communities; a person sees permitted sites. The current site/equipment is the initial filter when opening from its page, with an option to broaden to accessible sites. Outside a community, all authorized records can be queried.

The initial source is **committed inventory configuration reviews**, not arbitrary Docker output or a complete audit of every backend. Open/resolved reflects the current review status; confirmation times and notes are in its detail. The primary timeline time remains the original inventory change. Historical records do not contain verified authors, so no actor name is inferred from their untrusted free-text field. New authenticated inventory changes and confirmations display the account name from the server-verified identity. Internal operations without an initiating user remain unattributed.

Periods: 24 hours, 7/30 days, or custom dates inside the last 30 days. Custom end dates include the selected local day. Requests use ISO timestamps, a 40-item page and an opaque cursor. Scroll or Load older activity fetches the next page. Changing filters cancels stale requests. Missing-backend, expired-session, loading, empty and retry states are explicit. Native dialog semantics provide modal focus and Escape dismissal.

## Verification

`npm test` covers filters, pagination/deduplication, late responses, custom date bounds, unavailable service, confirmations and closing. `npm run test:console` checks the existing workspace runtime. `npm run build` type-checks and builds the app. Visual verification uses the actual local Community API and existing configuration reviews; no production records are created for the demonstration.

## Follow-up

The Community backend applies a 30-day read window and removes resolved reviews 30 days after final resolution. Unresolved configuration obligations remain in Configuration reviews. A full functional audit still needs coverage of Flexibility/Runtime/Training, authorized records for deleted resources and cross-service delivery. Those are backend increments, not labels that the UI should invent. The role policy remains: managers may view flexibility requests; this activity panel adds no ability to create them on another person's behalf.
