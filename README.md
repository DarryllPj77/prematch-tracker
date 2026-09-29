# PreMatch Tracker

PreMatch Tracker is a React application for recording player practice submissions and reviewing attendance and performance from a manager dashboard. Its Node.js, Express, Socket.io, and PostgreSQL backend provides authenticated accounts, real-time updates, and durable history.

## Features

- Separate player and manager dashboards
- Persistent callsign and four-digit PIN accounts with hashed PINs
- Manager-owned teams with permanent four-character invite codes
- Team-isolated rosters, submissions, presence, and target settings
- Player drill-result and screenshot submissions
- Manager attendance, history, player-presence, and target views
- Requirements snapshotting for historically accurate grading
- Real-time updates through Socket.io
- PostgreSQL persistence with LocalForage caching
- Private Neon Object Storage for cross-device screenshot proof
- ONNX Runtime Web integration for client-side model inference

## Tech stack

- React 19 and Vite 7
- LocalForage and ONNX Runtime Web
- Node.js and Express 5
- Socket.io
- PostgreSQL / Neon
- Neon Object Storage (S3-compatible)
- JSON Web Tokens and bcrypt

## Project structure

```text
PreMatch Tracker/
|- Public/                 # Public assets and ONNX model
|- ScreenshotsSamples/     # Example screenshots
|- server/
|  |- sql/schema.sql       # Idempotent PostgreSQL schema
|  |- src/                 # API, authentication, database, and Socket.io server
|  |- package.json
|  `- package-lock.json
|- shared/                 # Logic shared by the client and server
|- src/                    # React application
|- render.yaml             # Render Blueprint
|- package.json            # Client dependencies and scripts
`- vite.config.js
```

## Requirements

- Node.js
- npm
- PostgreSQL database (Neon is supported)

## Installation

```bash
git clone https://github.com/DarryllPj77/prematch-tracker.git
cd prematch-tracker
npm install
npm install --prefix server
```

Copy the environment template once and fill in the local database connection:

```bash
cp .env.example .env.local
```

Set `LOCAL_DATABASE_URL` to a disposable Neon development branch when possible. Local environment files are ignored by Git.

## Running locally

Start the API, Socket.io server, and Vite client together from the repository root:

```bash
npm run dev
```

The API runs at `http://localhost:3001`, and the client opens at `http://localhost:5173`. The database-aware health endpoint is `http://localhost:3001/health`.

Development mode automatically uses the local API URLs and reads `.env.local` or `server/.env`. Render sets `NODE_ENV=production`, so deployed builds automatically use Render's `DATABASE_URL`, `JWT_SECRET`, `MANAGER_SIGNUP_CODE`, `CLIENT_ORIGIN`, `VITE_API_URL`, and `VITE_SOCKET_URL` values instead.

## Environment variables

Local `.env.local`:

```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
LOCAL_DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
JWT_SECRET=prematch-local-development-jwt-secret-2026
MANAGER_SIGNUP_CODE=LOCAL-MANAGER-CODE
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
SCREENSHOT_BUCKET=prematch-screenshots
AWS_ACCESS_KEY_ID=your-neon-storage-access-key
AWS_SECRET_ACCESS_KEY=your-neon-storage-secret-key
AWS_ENDPOINT_URL_S3=your-neon-branch-storage-endpoint
AWS_REGION=ap-southeast-1
```

The server creates missing tables from `server/sql/schema.sql` when it starts. Never commit real `.env` files.

## Available scripts

From the repository root:

```bash
npm run dev        # Start the local API and Vite together
npm run dev:client # Start only Vite
npm run dev:server # Start only the local API
npm run build     # Build the frontend into dist/
npm run preview   # Preview the production frontend
```

From `server/`:

```bash
npm run dev       # Start the server with nodemon
npm start         # Start the server with Node.js
```

## Data and security notes

Accounts, target settings, submission metadata, requirements snapshots, and attendance history are stored in PostgreSQL. PINs are hashed with bcrypt, and authenticated API and Socket.io requests use signed JSON Web Tokens.

Each manager receives a permanent team invite code during registration. Players must provide a valid manager code when registering, and all manager/player Socket.io traffic and database queries are scoped to that team. After upgrading an older deployment, existing managers receive codes automatically. Legacy players remain unassigned for privacy and can join the correct team by registering again with their existing callsign and PIN plus that manager's team code.

Screenshot files are uploaded through the authenticated API to a private, team-scoped Neon Object Storage bucket. PostgreSQL stores only the object keys, and LocalForage acts as a short-lived browser cache. The API enforces team ownership for every upload and download. Never expose `DATABASE_URL`, `JWT_SECRET`, `MANAGER_SIGNUP_CODE`, or any `AWS_*` storage credential through a `VITE_*` variable.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Render and Neon deployment procedure.

## License

No license has been added yet.
