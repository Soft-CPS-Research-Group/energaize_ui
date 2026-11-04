# Activity timeline

REC Managers and consumers open Activity from the history icon beside the account
menu. It is a modal timeline scoped initially to the current community, home or
equipment, with an option to broaden the selection to accessible resources.

## Records and authorization

The panel reads `/community-api/api/identity/activity` using the existing account
session. The backend applies authorization before pagination: managers see their
permitted communities and consumers see their permitted sites.

The current source is committed inventory configuration reviews. This is not a
complete cross-service audit or a Docker log viewer. Open/resolved describes the
review's current status; confirmation times and notes appear in its detail. The
timeline's primary timestamp remains the original inventory change.

Authenticated changes display the name supplied by the verified server identity.
Historical free-text author fields do not establish an author, and internal
operations without an initiating user remain unattributed.

## Filters and loading

- Periods: last 24 hours, 7 days, 30 days, or custom dates within the last 30 days.
- Custom end dates include the selected local day; API requests use ISO timestamps.
- Requests use 40-item pages and an opaque cursor. Scrolling or **Load older
  activity** retrieves another page.
- Changing filters cancels stale requests. Loading, empty, expired-session,
  unavailable-service and retry states are distinct.
- The modal supports focus handling and Escape dismissal.

## Retention and limits

The Community backend applies the 30-day read window and removes resolved reviews
30 days after final resolution. Unresolved obligations remain in Configuration
reviews. Reading activity does not grant permission to modify the underlying
resource or create another person's flexibility request.

Flexibility, Runtime and Training events, deleted-resource visibility and
cross-service delivery require their own backend coverage before they can be
presented as part of this timeline.

## Maintenance

`src/console/ActivityPanel.tsx` implements the panel. Its tests cover filtering,
pagination, deduplication, late responses, date bounds, errors and closing.
See [development checks](development.md#checks) and
[Community Console](COMMUNITY_CONSOLE.md) for setup and related controls.
