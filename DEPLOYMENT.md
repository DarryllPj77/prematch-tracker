# Render + Neon deployment

## 1. Prepare the production Neon branch

The private `prematch-screenshots` bucket is declared in `neon.ts`. Apply it to the production branch and pull that branch's database and storage variables:

```powershell
neon checkout production
neon deploy
```

Open the ignored `.env.local` file and use its production `DATABASE_URL` and four `AWS_*` values for Render. After copying them, restore the local development branch:

```powershell
neon checkout development
```

Never commit any value from `.env.local`. These values belong only in the backend service environment.

## 2. Create or sync the Render Blueprint

1. Push this repository to GitHub.
2. In Render, choose **New > Blueprint**.
3. Connect `DarryllPj77/prematch-tracker`.
4. Render will read `render.yaml` and create the API web service and frontend static site.

Provide these prompted values:

### Backend service

- `DATABASE_URL`: the pooled Neon connection string
- `MANAGER_SIGNUP_CODE`: a private code required when registering a manager
- `CLIENT_ORIGIN`: the final frontend URL, such as `https://prematch-tracker.onrender.com`
- `SCREENSHOT_BUCKET`: `prematch-screenshots`
- `AWS_ACCESS_KEY_ID`: the production branch's Neon Object Storage access key
- `AWS_SECRET_ACCESS_KEY`: the production branch's Neon Object Storage secret
- `AWS_ENDPOINT_URL_S3`: the production branch's storage endpoint
- `AWS_REGION`: the production branch's AWS region

Render generates `JWT_SECRET` automatically.

The Blueprint enables deploy-on-commit for both services. After adding the new storage variables, deploy `prematch-tracker-api` and confirm its health endpoint reports `"screenshotStorage":"configured"`.

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
{"ok":true,"database":"connected","screenshotStorage":"configured"}
```

Then open the frontend and verify:

1. Register one manager using `MANAGER_SIGNUP_CODE`.
2. Register a player in another browser or private window.
3. Change target settings as the manager.
4. Confirm the player receives the settings in real time.
5. Submit a player run.
6. Confirm it appears in the manager dashboard.
7. Open the manager in another browser and confirm every screenshot loads.
8. Log out and sign in from another browser to confirm users and history persist.

## Security notes

- Never expose `DATABASE_URL`, `JWT_SECRET`, or `MANAGER_SIGNUP_CODE` through a `VITE_*` variable.
- Rotate any secret that is accidentally committed or shared publicly.
- Keep the bucket private. Storage credentials belong only on the backend service and must never use a `VITE_*` prefix.
- Existing browser-only screenshots cannot be recovered automatically; players must submit new proof after this integration is deployed.
