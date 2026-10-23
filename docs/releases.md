# Releases

## 0.3.1 — 2026-10-23

Job submission keeps the same identity while a response is uncertain, including
retry after page reload. Acknowledging a successful submission starts a fresh
identity for the next run. Keys are separated by account and workspace.
Validated by retry/reload tests and the production build.
