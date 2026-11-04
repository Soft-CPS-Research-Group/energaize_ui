# AI Manager: training and deployment

The AI Manager lives in this application under `/app/ai/*`. It includes Jobs,
Datasets, Experiment Configs, job comparison, result inspection and Deploy.
Accounts with `ai_manager` or `training_manager` roles enter the relevant routes;
backend permissions determine the operations available within a workspace.

## Configuration and identity

`VITE_AI_TRAINING_ENABLED=true` enables the connected workspace flow at build time.
The Docker CI build supplies this flag. Training requests use
`VITE_AI_TRAINING_API_URL`, defaulting to `/ai-training-api`; the packaged Nginx
upstream is configured with `AI_TRAINING_API_URL`.

Sign-in and profile data come from the same Community account session as other
roles. The connected workspace no longer requires a separately provisioned browser
Training token. An unavailable account or workspace service must remain a visible
error rather than silently selecting example data.

With the feature flag disabled, compatibility paths remain in the application.
The Job Orchestrator and legacy Training gateway addresses are documented in
[development](development.md); their responsibilities are separate from the scoped
Training API and the Runtime service.

## Workspace selection

The selector loads permitted workspaces from `/api/training/workspaces`.
Laboratory is the personal training area, while community workspaces refer to
accessible communities. Search filters the community list and leaves Laboratory
available. The selection is remembered locally.

Changing account or workspace creates a separate query cache and resets scoped
page state. Pending mutations prevent workspace changes. Laboratory folders are
personal; community folders use the permissions of their shared workspace.

## Experiments and results

- **Datasets:** inspect and organize datasets; community preparation selects live
  inventory and configured telemetry, with review of replay assumptions.
- **Experiment Configs:** manage experiment definitions and their visual editor.
- **Jobs:** submit an experiment, inspect status, progress, logs and available
  results, and compare runs and KPIs. Submission retries retain their request
  identity while the original result is uncertain.
- **Job detail:** exposes configuration/dataset provenance where supplied by the
  backend. Active jobs refresh until a terminal status; result files and optional
  simulation data are loaded separately.

Missing simulation output, missing KPI mappings and failed reads are distinct
states. The presence of a job entry does not establish that its model or outputs
are ready for deployment. Candidate registration uses the backend's finished-job
and export checks.

## Deployment

Deploy connects model/candidate selection to accessible sites and the Runtime
backend. Runtime owns instance state and service operations. Job Orchestrator owns
job scheduling and worker execution; selecting a training workspace does not
change a house's runtime placement.

For the REC Manager's service plan, Percepta settings and message viewer, see
[Community deployment](COMMUNITY_CONSOLE.md#deployment). Plan review, configuration
editing and starting a service are separate actions.

## Development fixtures and checks

The optional, Git-ignored `example/jobs/` directory supplies local job/result
fixtures to development adapters. It is not a replacement for backend experiment
provenance. `VITE_SIMULATION_DATA_PROVIDER` defaults to `backend`; local examples
and mock data should remain explicitly separated from connected results.

Relevant checks are `npm test`, `npm run test:console` and `npm run build`.
Workspace isolation, mutation guards, submission identity and result-loading
behavior have regression tests under `src/`.
