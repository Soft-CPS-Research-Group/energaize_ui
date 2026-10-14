# EnergAIze UI

React + Vite + TypeScript frontend for EnergAIze, focused on:
- Login and role-based access (mock auth)
- Community selection flow
- Shared shell (top navigation, entity tree, notifications, account, logs)
- AI Manager module: `Jobs`, `Datasets`, `Experiment Configs`
- Backend integration with `opeva_backend_api_training` and `job_orchestrator_agent`

## Tech Stack
- React 18
- React Router 6
- TanStack Query
- Framer Motion
- Lucide icons
- Vitest + Testing Library + MSW

## Environment
Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Default API base URLs:

```bash
VITE_API_BASE_URL=http://193.136.62.78:8000
VITE_JOB_ORCHESTRATOR_API_URL=http://193.136.62.78:8011
```

`VITE_API_BASE_URL` is still used for backend-owned deploy/Mongo/schema endpoints.
Jobs, queues, hosts, configs, datasets and simulation-data calls use
`VITE_JOB_ORCHESTRATOR_API_URL`. If it is not set, the UI derives it from
`VITE_API_BASE_URL` by keeping the same host and switching the port to `8011`.

## Install and Run

```bash
npm install
npm run dev
```

## Build and Test

```bash
npm run build
npm run test
```

## Docker

Build image:

```bash
docker build -t calof/energaize_ui:latest .
```

Run container (UI on `http://<host>:8006`):

```bash
docker run -d --name energaize_ui -p 8006:80 calof/energaize_ui:latest
```

## Mock Credentials
- `ai@energaize.io` / `ai123` -> AI Manager
- `rec@energaize.io` / `rec123` -> REC Manager
- `prosumer@energaize.io` / `pros123` -> Prosumer

## Notes
- REC/member community selection uses the Community API. Legacy Mongo database names are not REC inventory.
- AI Manager bypasses community selection and lands directly in the training workspace.
- API base URLs are environment-driven to support local Docker networking.
- Institutional logos are placeholders in UI text blocks until final assets are provided.
- On push to `main`, GitHub Actions builds and pushes `calof/energaize_ui:latest` to Docker Hub.


## Community Console

EnergAIze has one React application and one `/login` for Jobs, REC Manager, Prosumer, KPI and predictor roles. The new community views are integrated at `/communities` and `/app/community/*`; the old `/console/index.html` address redirects to the app. Community identities and permissions come from the new backends. See [setup and current limitations](docs/COMMUNITY_CONSOLE.md). `npm run dev:console` remains a compatibility command to start the **whole app** on port 5177; it no longer launches a separate console. Use `npm run test:console` for the workspace model/transport tests and `npm run check:console-backends` for the local services.

Telemetry stores signal configuration and now provides read-only Mongo measurement queries. The connected console uses its explicit sensor bindings, source explorer, history and optional incremental refresh. Percepta remains the measurement writer. The old API also serves Deploy, bundles and inference logs; see the transition audit in the console guide before retiring it.

For a coordinated first test rollout, see `docs/COMMUNITY_CONSOLE.md` (latest deployment review) and the infrastructure repository's `energaize_ui/README.md`. The Docker image accepts `COMMUNITY_API_URL`, `ACCESS_API_URL`, `TELEMETRY_API_URL` and `FLEXIBILITY_API_URL` at startup. Set these to reachable backend addresses without trailing slashes; the infrastructure compose uses internal Docker names. Pin the published UI commit SHA alongside the backend SHA for reproducibility.

### Site runtime

Percepta and Algorithm tabs use `/runtime-api` (development target 127.0.0.1:8021;
server proxy configured with `RUNTIME_API_URL`). Administration shows registered
hosts and existing instances, with explicit site association. Simulation instances
are labelled and never represent real equipment data. Controller models and recent
logs are available inside the site; the existing training-manager Deploy page uses
the same new Runtime backend. Jobs continue using their own orchestrator.

### Community administration

The community editor and account creation use centred, staged forms. A manager can create
a resident, assign community homes immediately and retry access reconciliation without
creating a duplicate account. Sign-in still uses the existing test password `pros123`;
invitation codes and personal passwords are not implemented.

Simple comparison contracts expose fixed EUR/kWh, contracted kVA and standing charges.
The community tariff links an existing EUR/kWh sensor channel to a named price source
and expresses member sales as a percentage (initially 80%) of that same stream. Percepta
is expected to supply the price every 15 minutes; this editor does not create a producer
or invent readings. Existing contract versions and unrelated price components are
preserved; contracts outside this simple model retain the detailed editor.

Managers can open Configuration changes from the community/site header or Administration.
Each inventory change remains pending until algorithm, Percepta and other integrations
have individual manual confirmations with notes. These confirmations do not deploy services.
