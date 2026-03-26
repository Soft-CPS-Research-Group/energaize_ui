# EnergAIze UI

React + Vite + TypeScript frontend for EnergAIze, focused on:
- Login and role-based access (mock auth)
- Community selection flow
- Shared shell (top navigation, entity tree, notifications, account, logs)
- AI Manager module: `Jobs`, `Datasets`, `Experiment Configs`
- Backend integration with `opeva_backend_api_training`

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

Default API base URL:

```bash
VITE_API_BASE_URL=http://193.136.62.78:8000
```

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
- Community list is static in this version (as requested), but context switching is wired.
- AI Manager bypasses community selection and lands directly in the training workspace.
- API base URL is environment-driven to support local Docker networking.
- Institutional logos are placeholders in UI text blocks until final assets are provided.
- On push to `main`, GitHub Actions builds and pushes `calof/energaize_ui:latest` to Docker Hub.
