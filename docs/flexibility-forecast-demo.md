# Flexibility forecast demonstration — 1 November 2026

## Review

Run the UI and open `/demo/flexibility`. The resident/manager Flexibility calendar
also links to this page in a separate tab. No account is required for the public
demonstration because every identity, device, request and forecast is synthetic.

Presentation follows the existing community palette, with an equipment selector,
shared time axis, separate source rows, forecast metadata and a discussion prompt.
The component does not call an API or persist state. The app's normal session
discovery may run, but no demonstration action writes production data. Reloading,
resetting or switching equipment/scenario discards the local demonstration changes.

There are two equipment fixtures: an EV/charger with a departure target, and a
washer whose Eco programme lasts 90 minutes. The latter rejects shortening its
request below that duration. These fixtures are not a real inventory catalogue.

`flexibilityDemoModel.ts` is an internal presentation fixture, **not** Bernardo's
wire protocol or a backend selection implementation. A future adapter can supply
real results after agreement of the semantics, IDs, horizon and validity.

## Walkthrough

1. Open **Fontes sobrepostas** on the EV. Compare recurring 18–08, one-off 19–07,
   and the simulated forecast 20–08. None is automatically selected.
2. Advance the one-off ending by one hour. Its revision increments; recurring and
   forecast sources remain unchanged. Cancel it, then create a new one-off request.
   The cancelled row and operation history remain, as does the forecast.
3. Switch to **À espera do resultado**. Edit/cancel a request before receiving the
   simulated result. Receipt adds the forecast without overwriting those changes.
4. Simulate repeated/old result delivery. The local scenario keeps one forecast
   and records why it ignored the duplicate/old revision. This demonstrates desired
   presentation, not a tested network integration with the future predictor.
5. Review **Sem histórico**, **Falha do predictor** and **Previsão expirada**.
   Missing information is not zero flexibility; technical failure is not predicted
   unavailability. Expired predictions remain visible as history.
6. Review the habitual-use scenario. Its interval estimates usage, not an assumed
   availability window. The other forecast windows explicitly use availability as
   a hypothetical semantic to discuss with Bernardo.
7. Inspect Lisbon's spring/autumn clock-change nights: local 18–08 spans 13/15 real
   hours respectively, with explicit WET/WEST offsets in the displayed timestamps.
8. Switch to the washer. Its programme comes from the equipment fixture. Attempting
   to shorten its two-hour one-off window by an hour is refused. Switching devices
   never carries across the EV's requests or cancellations.

The recurring row represents one already-expanded occurrence. This new component
does not replace the backend recurrence engine or its exception/cancellation API.
The demonstration history is an in-memory journal, not the production audit store.

## Selection discussion scenarios

No precedence below is approved or active. Recurring and one-off requests are both
explicit user declarations. Compare candidate policies before choosing one; a
statistical model may inform eligibility but cannot invent missing authorization.

| Case | Inputs | Decision to discuss / invariant |
| --- | --- | --- |
| S01 | One recurring request, no forecast | Can that request alone be used? Preserve its source and revision. |
| S02 | One-off overlaps a recurring occurrence | Replace the whole occurrence, constrain it or preserve alternatives? Define the scope of an exception. |
| S03 | Two incompatible one-off requests | Flag a conflict, use latest revision of the same request, or apply another agreed policy? Distinct requests are not revisions. |
| S04 | EV declared 18–08; predicted arrival 20h | Arrival, charger connection and availability differ. Which output can restrict which window? |
| S05 | Habitual use predicted at 20h | A likely start does not establish freedom to move operation to another hour. |
| S06 | Valid forecast, no explicit request | May it contribute under existing equipment participation settings? No per-forecast human approval; do not invent permission. |
| S07 | No history, mapping or failed computation | Keep uncertainty distinct from predicted zero availability; choose a documented fallback. |
| S08 | Expired forecast alongside a valid explicit request | Retain historical provenance; decide usable sources without silently refreshing validity. |
| S09 | User cancels one request | Do not resurrect that request when a result arrives. Decide separately whether other sources remain usable. |
| S10 | Duplicate, old or delayed forecast | No duplicate candidate; define validity and revision handling with Bernardo. |
| S11 | Window crosses midnight or clock change | Resolve actual instants and elapsed duration. Ambiguous/nonexistent wall times need explicit treatment. |
| S12 | Washer programme cannot fit the remaining window | Do not shrink the programme or silently extend the user window. Expose infeasibility. |
| S13 | Pump needs total running time, potentially split | Define whether splitting is allowed; total runtime and a single contiguous cycle differ. |
| S14 | HVAC comfort interval | Availability alone is insufficient; preserve applicable temperature/comfort constraints. |

The executable UI covers S02/S04/S05/S07/S08/S09/S10/S11/S12 and source comparison.
The table also contains discussion-only cases; it does not claim to implement a
policy evaluator, HVAC/pump dynamics, optimization, recurring-series management,
forecast-only authorization, or the real predictor/consumer integrations.

For each policy considered later, record the equipment, period, eligible sources
and revisions, policy version, chosen source(s), reason and constraints. Test both
successful and no-valid-choice outcomes. The existing backend decision-history
method can store real decisions later; reading a forecast must not create one.

## Boundaries and coordination

- SOF-98: UI preparation is independently reviewable; real forecast integration is
  still open under SOF-15/SOF-96. Simulated results must never become production data.
- SOF-97: scenario preparation only, without choosing or deploying a selection rule.
- SOF-227: no Percepta/algorithm consumer connected by this UI release.
- SOF-259: remaining administrative revocation/expiry is explicitly postponed to
  low-priority backlog by Tiago. Existing authorization is preserved.
- Isolated worktree/branch based on UI main `26cc4f8`; backend and other agents'
  worktrees are untouched. Merge/reconcile with current main before any publication.

## Verification

The new unit/component tests exercise source separation, identity isolation,
editing/revisions, cancellation/history, receive/repeat/old result behavior,
expiry boundaries, missing history/errors, washer duration and Lisbon clock changes.
Application integration tests cover the calendar link and anonymous direct demo.
Browser smoke covers the workflow at desktop and 390px mobile widths, asserts no
JavaScript errors or mutation requests, and checks horizontal overflow.

These tests establish the local UI demonstration behavior. They do not establish
Bernardo's protocol, deployed prediction quality or actual consumer behavior.
