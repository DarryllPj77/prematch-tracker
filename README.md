# PreMatch Tracker

PreMatch Tracker is a local-first React application for recording player practice submissions and reviewing attendance and performance from a manager dashboard. A lightweight Node.js, Express, and Socket.io server relays live updates between connected clients.

## Features

- Separate player and manager experiences
- Local callsign and four-digit PIN registration
- Player drill-result and screenshot submissions
- Manager attendance, submission history, player-presence, and target views
- Real-time updates through Socket.io
- Browser-side persistence with LocalForage
- ONNX Runtime Web integration for client-side model inference

## Tech stack

- React 19
- Vite 7
- LocalForage
- ONNX Runtime Web
- Node.js and Express 5
- Socket.io
- Nodemon for server development

## Project structure

```text
PreMatch Tracker/
├── Public/                 # Public assets and ONNX model
├── ScreenshotsSamples/     # Example screenshots
├── server/
│   ├── src/                # Express and Socket.io relay
│   ├── package.json
│   └── package-lock.json
├── shared/                 # Logic shared by the client and server
├── src/                    # React application
├── index.html
├── package.json            # Client dependencies and scripts
├── package-lock.json
└── vite.config.js
```

## Requirements

- Node.js
- npm

## Installation

Clone the repository and install the client dependencies:

```bash
git clone https://github.com/DarryllPj77/prematch-tracker.git
cd prematch-tracker
npm install
```

Install the server dependencies:

```bash
cd server
npm install
cd ..
```

## Running locally

Start the Socket.io server in one terminal:

```bash
cd server
npm run dev
```

The server runs at `http://localhost:3001` by default. Its health endpoint is available at `http://localhost:3001/health`.

Start the Vite client from the repository root in another terminal:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

## Environment variables

Environment variables are optional for the default local setup.

Client `.env`:

```env
VITE_SOCKET_URL=http://localhost:3001
```

Server `server/.env`:

```env
PORT=3001
```

The server reads `PORT` from its process environment. It does not currently load `.env` files automatically, so use your shell environment or add a dotenv loader before relying on `server/.env`.

Do not commit real `.env` files. They are excluded by the repository `.gitignore`.

## Available scripts

From the repository root:

```bash
npm run dev       # Start the Vite development server
npm run build     # Create a production build in dist/
npm run preview   # Preview the production build locally
```

From `server/`:

```bash
npm run dev       # Start the relay with nodemon
npm start         # Start the relay with Node.js
```

## Data and security notes

This project has no database. Accounts, PINs, profiles, logs, and screenshots are stored in the current browser through LocalForage. The Node.js server is an in-memory real-time relay and does not provide durable storage.

Clearing browser storage, changing browsers, or using another device will not preserve or automatically transfer local records. The local PIN system is intended for a trusted local or development environment and is not production-grade authentication.

## License

No license has been added yet.
