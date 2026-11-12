# Development and configuration

## Local setup

Use Node.js 22 (`.nvmrc`) and the committed npm lockfile. On a new checkout:

```sh
npm ci
cp .env.example .env
npm run dev
```

Edit an existing `.env` rather than replacing its environment-specific values.
Vite reports the local address when it starts. `npm run dev:console` starts the same
application on `127.0.0.1:5177`; it does not launch a separate console. Neither
command starts backends or creates accounts.

Use same-origin API paths when reviewing server-managed sessions. The following
build-time values select the existing Vite/Nginx gateways:

```dotenv
VITE_API_BASE_URL=/training-api
VITE_JOB_ORCHESTRATOR_API_URL=/jobs-api
VITE_PREDICTOR_API_URL=/predictor-api
VITE_KPI_API_URL=/kpi-api
VITE_AI_TRAINING_ENABLED=true
```

The connected Training API defaults to `/ai-training-api`. The last setting is a
build-time feature flag; see [Training](training.md). Restart Vite after changing
environment configuration.

## Services and proxies

The following are Vite's current targets. Backend processes must be available at
those addresses or at the configured overrides.

| Browser prefix | Purpose | Development target | Override |
| --- | --- | --- | --- |
| `/community-api` | Accounts, RECs, sites and assets | `127.0.0.1:8017` | `COMMUNITY_PROXY_TARGET` |
| `/access-api` | Roles, grants and authorization | `127.0.0.1:8018` | `ACCESS_PROXY_TARGET` |
| `/telemetry-api` | Channels, bindings and stored readings | `127.0.0.1:8019` | `TELEMETRY_PROXY_TARGET` |
| `/flexibility-api` | Requests, calendars and prediction sources | `127.0.0.1:8020` | `FLEXIBILITY_PROXY_TARGET` |
| `/runtime-api` | Deployment plans, instances and Percepta inspection | `127.0.0.1:8021` | `RUNTIME_PROXY_TARGET` |
| `/ai-training-api` | Scoped Training workspaces | `127.0.0.1:8022` | `AI_TRAINING_PROXY_TARGET` |
| `/measurement-api` | Legacy measurement compatibility | `193.136.62.78:8000` | `MEASUREMENT_PROXY_TARGET` |
| `/jobs-api` | Job Orchestrator compatibility | `193.136.62.78:8011` | Defined in `vite.config.ts` |
| `/training-api` | Legacy training/deploy API | `193.136.62.78:8000` | Defined in `vite.config.ts` |
| `/predictor-api` | Forecasting service | `193.136.62.78:8006` | Defined in `vite.config.ts` |
| `/kpi-api` | KPI service | `193.136.62.78:8007` | Defined in `vite.config.ts` |

The Jobs, legacy Training, predictor and KPI gateways check workspace access
through the Community session before forwarding requests. Setting a browser API
URL to another origin changes that request path and requires a compatible session
and cross-origin configuration.

Backend setup and API contracts are maintained in
[bounded-context-be](https://github.com/Soft-CPS-Research-Group/bounded-context-be).
Local sandbox data is optional. Seed and integration scripts under `scripts/`
write backend records, and some default to server addresses. Review their target
URLs and authentication requirements before using them in an isolated test
environment. They are not required for the normal frontend checks below.

## Checks

| Command | Scope |
| --- | --- |
| `npm run lint` | TypeScript check configured by the package script |
| `npm test` | React, API adapter and utility tests under `src/` |
| `npm run test:console` | Community model and transport tests under `tests/console/` |
| `npm run build` | Project type-check and production Vite build into `dist/` |
| `npm run preview` | Preview the built frontend from `dist/` |

Test output is the source of current test counts. These documents do not record
passing counts from earlier revisions as guarantees for later changes.

## Packaging and publication

The Dockerfile uses Node 22 to build and Nginx to serve `dist/`. To include the
connected AI Manager, pass `VITE_AI_TRAINING_ENABLED=true` as a Docker build argument;
the repository's CI already does so. Other `VITE_*` values are frontend build-time
configuration, not Nginx startup settings.

The Nginx template accepts these upstream variables at container startup:
`COMMUNITY_API_URL`, `ACCESS_API_URL`, `TELEMETRY_API_URL`, `FLEXIBILITY_API_URL`,
`RUNTIME_API_URL`, `AI_TRAINING_API_URL`, `JOBS_API_URL`, `TRAINING_API_URL`,
`PREDICTOR_API_URL` and `KPI_API_URL`. Upstreams need to be reachable from the
container; its `127.0.0.1` is not the host or a sibling service.

The root Compose file is a legacy image/Watchtower launcher. Its `VITE_*` runtime
entries do not rebuild frontend settings. Coordinated server configuration belongs
to the [infrastructure repository](https://github.com/Soft-CPS-Research-Group/opeva_infra_services).

GitHub Actions runs the frontend checks and Docker build for pull requests. A
push to `main` also publishes commit-SHA and `latest` image tags. There is no
documentation-only exclusion in that workflow. Review the infrastructure's update
policy before pushing a change intended to leave deployment untouched.

## Visual assets

Application images and institutional logos are under `public/assets/`. Generated
Mediterranean illustrations are concepts, not photographs of the selected property
or measured equipment geometry. Scene selection and hotspots are implemented in
`public/console/mediterranean-scenes.js` and the community view modules. Preserve
their equipment matching and alignment when replacing an illustration.

Generation prompts and asset provenance are retained in
[provenance.json](mediterranean-ceramic/provenance.json),
[login-backgrounds.json](mediterranean-ceramic/login-backgrounds.json),
[ev-artwork.json](mediterranean-ceramic/ev-artwork.json),
[ev-artwork-v2.json](mediterranean-ceramic/ev-artwork-v2.json) and
[ev-station-v3.json](mediterranean-ceramic/ev-station-v3.json).
These are historical asset records, not a build manifest. Their original generator
paths describe the creation environment and are not setup dependencies. The current
assets, login rotation and charging animation are defined by application code.
