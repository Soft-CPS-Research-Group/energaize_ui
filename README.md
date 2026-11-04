# EnergAIze UI

EnergAIze is a React application for managing energy communities, household
equipment and AI experiments. REC Managers, consumers, AI Managers, predictor and
KPI users share one login, account menu and application shell. The interface is
in English and uses the Mediterranean Ceramic visual style.

## Development

Use Node.js 22 and npm. For a new checkout:

```sh
npm ci
cp .env.example .env
npm run dev
```

Configure the upstream services in `.env` before using connected workspaces.
The frontend does not start those services. See [development and configuration](docs/development.md)
for proxy settings, build options and checks.

## Workspaces

| Area | Entry point | Guide |
| --- | --- | --- |
| REC Manager and consumer | `/communities`, `/app/community/*` | [Community Console](docs/COMMUNITY_CONSOLE.md) |
| AI Manager | `/app/ai/jobs`, `/app/ai/datasets`, `/app/ai/configs`, `/app/ai/deploy` | [Training and deployment](docs/training.md) |
| Predictor | `/app/predictor/*` | Views and API adapters under `src/pages/ai/predictor/` |
| KPI Manager | `/app/kpi-manager/*` | Views under `src/pages/kpi-manager/` |
| Account | `/app/account` | Shared profile, photo, password and account controls |

Available areas depend on the signed-in account's roles and backend permissions.
The old `/console/index.html` address redirects to the application.

## Accounts

Authentication and account data come from the Community backend, through
`/community-api/api/identity`. The frontend uses the server-managed session for
sign-in, profile updates, role switching and logout. Invitation, email confirmation
and password recovery use `/account-access` and `/forgot-password`.

The login's test-account picker reads the backend's existing account directory.
Account availability and credentials belong to that environment; the directory
does not replace authentication. Profile photos are loaded from the backend.

## Documentation

- [Development](docs/development.md): configuration, service boundaries, checks,
  packaging and visual asset provenance.
- [Community Console](docs/COMMUNITY_CONSOLE.md): inventory, measurements,
  flexibility, deployment and Percepta messages.
- [Training](docs/training.md): workspace selection, experiments, results and
  deployment boundaries.
- [Activity](docs/activity.md): timeline scope, filters and supported records.
- [Concurrent editing](docs/concurrent-editing.md): versioned saves and conflict
  handling.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | React pages, API adapters, shared components, styles and tests |
| `public/console/` | Active community view modules compiled into the React app |
| `config/` | Vite integration for the community workspace |
| `public/assets/` | Application artwork, equipment icons and institutional logos |
| `tests/console/` | Community model and transport tests |
| `docker/` | Nginx proxy template for the built application |
| `scripts/` | Sandbox setup and integration checks |

`node_modules/`, `dist/`, `example/`, local environment files and TypeScript build
metadata are ignored by Git. The optional `example/` job fixtures are still read by
development adapters; they are not documentation or a production data source.

## Publication

The GitHub Actions workflow validates the application and builds a Docker image.
A push to `main` publishes both the commit-SHA tag and `latest` to Docker Hub.
Upstream addresses for the packaged app are configured through Nginx environment
variables; `VITE_*` values are compiled into the frontend. Deployment procedures
and service definitions belong to the
[infrastructure repository](https://github.com/Soft-CPS-Research-Group/opeva_infra_services).
