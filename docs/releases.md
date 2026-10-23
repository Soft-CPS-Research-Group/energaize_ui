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
