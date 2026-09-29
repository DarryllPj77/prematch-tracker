# Render + Neon deployment

## 1. Copy the Neon connection string

In the Neon project, select the `br-soft-violet-aojggyd1` branch and `neondb` database, click **Connect**, enable the pooled connection option, and copy the connection string.

Never commit this value. It belongs only in the backend service's `DATABASE_URL` environment variable.

## 2. Create the Render Blueprint

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint**.
3. Connect `DarryllPj77/prematch-tracker`.
4. Render will read `render.yaml` and create the API web service and frontend static site.

Provide these prompted values:

### Backend service

- `DATABASE_URL`: the pooled Neon connection string
- `MANAGER_SIGNUP_CODE`: a private code required when registering a manager
- `CLIENT_ORIGIN`: the final frontend URL, such as `https://prematch-tracker.onrender.com`

Render generates `JWT_SECRET` automatically.

### Frontend static site

- `VITE_API_URL`: the API URL, such as `https://prematch-tracker-api.onrender.com`
- `VITE_SOCKET_URL`: the same API URL

If Render changes either service name because the preferred name is unavailable, use the actual generated URLs and redeploy both services after updating the environment variables.

## 3. Verify deployment

Open the backend health endpoint:

```text
https://YOUR-API-SERVICE.onrender.com/health
```

Expected response:

```json
{"ok":true,"database":"connected"}
```

Then open the frontend and verify:

1. Register one manager using `MANAGER_SIGNUP_CODE`.
2. Register a player in another browser or private window.
3. Change target settings as the manager.
4. Confirm the player receives the settings in real time.
5. Submit a player run.
6. Confirm it appears in the manager dashboard.
7. Log out and sign in from another browser to confirm users and history persist.

## Security notes

- Never expose `DATABASE_URL`, `JWT_SECRET`, or `MANAGER_SIGNUP_CODE` through a `VITE_*` variable.
- Rotate any secret that is accidentally committed or shared publicly.
- Screenshot binaries remain browser-local. Persist them with object storage rather than PostgreSQL if cross-device image viewing is required.
