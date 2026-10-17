# AI Manager workspaces — 0.2.0

Enable at build time with VITE_AI_TRAINING_ENABLED=true. Configure the signed-session
Training API through AI_TRAINING_API_URL at container startup. Existing community,
prosumer, predictor and KPI navigation is retained.

Laboratory and real communities share Jobs, Datasets, Experiment Configs and Deploy.
The workspace selector separates page state and query caches, including across
account changes. Pending mutations prevent changing workspace. Laboratory folders
are personal; community folders are shared within the permitted workspace. Folders
can be created, renamed, removed and used to organize datasets/configs/jobs.

Community dataset preparation selects live inventory and bound telemetry channels,
requires review of the electrical replay assumptions, and can create a baseline
experiment configuration. Deployment shows actual Runtime state and available KPIs;
missing associations or KPI mappings remain explicit. No synthetic coverage or
household data is presented in the connected training workspace.

Verification: production build and 219 tests passed. The existing large frontend
bundle warning remains; this release does not claim a code-splitting improvement.
