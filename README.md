# PreMatch Tracker

PreMatch Tracker is a React application for recording player practice submissions and reviewing attendance and performance from a manager dashboard. Its Node.js, Express, Socket.io, and PostgreSQL backend provides authenticated accounts, real-time updates, and durable history.

## Features

- Separate player and manager dashboards
- Persistent callsign and four-digit PIN accounts with hashed PINs
- Player drill-result and screenshot submissions
- Manager attendance, history, player-presence, and target views
- Requirements snapshotting for historically accurate grading
- Real-time updates through Socket.io
- PostgreSQL persistence with LocalForage caching
- ONNX Runtime Web integration for client-side model inference

## Tech stack

- React 19 and Vite 7
- LocalForage and ONNX Runtime Web
- Node.js and Express 5
- Socket.io
- PostgreSQL / Neon
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

Copy the environment templates and fill in your database and secrets:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

## Running locally

Start the API and Socket.io server in one terminal:

```bash
cd server
npm run dev
```

The server runs at `http://localhost:3001`. Its database-aware health endpoint is `http://localhost:3001/health`.

Start the Vite client from the repository root in another terminal:

```bash
npm run dev
```

Open `http://localhost:5173`.

## Environment variables

Client `.env`:

```env
VITE_API_URL=http://localhost:3001
VITE_SOCKET_URL=http://localhost:3001
```

Server `server/.env`:

```env
DATABASE_URL=postgresql://user:password@host/neondb?sslmode=require
JWT_SECRET=replace-with-at-least-32-random-characters
MANAGER_SIGNUP_CODE=replace-with-a-private-manager-registration-code
CLIENT_ORIGIN=http://localhost:5173
PORT=3001
```

The server creates missing tables from `server/sql/schema.sql` when it starts. Never commit real `.env` files.

## Available scripts

From the repository root:

```bash
npm run dev       # Start Vite
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

Screenshot blobs remain in LocalForage on the browser that uploaded them. Their metadata is persisted, but viewing the actual image from another browser requires a future object-storage integration. Never expose `DATABASE_URL`, `JWT_SECRET`, or `MANAGER_SIGNUP_CODE` through a `VITE_*` variable.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Render and Neon deployment procedure.

## License

No license has been added yet.
