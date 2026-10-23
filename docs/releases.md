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
