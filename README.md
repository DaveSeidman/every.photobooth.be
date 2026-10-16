# Every Photobooth Backend

Express service for the Every text-directed AI portrait booth.

## Every styles

- Weights & Measures
- Digital Twins
- Future of Work
- Black & White

Only the source portrait is sent to `fal-ai/nano-banana/edit`. Reference images remain local research material and are never included in inference requests. The finished image is saved with the original camera frame notched into its upper-left corner.

PostHog mode uses a separate paper-diorama prompt that translates each photographed attendee into one recognizable miniature hedgehog character. Select it by submitting `mode=posthog`.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Set `FAL_KEY` in `.env`. The API runs on `http://localhost:8000`.

Open `http://localhost:8000/` in a browser (or `/status`) for the auto-refreshing operations dashboard. `/api/status` returns the same activity as JSON; `/health` and JSON requests to `/` retain their existing responses.

The dashboard shows all-time/today completed portraits, active jobs, failures, restart-interrupted jobs, AI configuration and uptime. Printing is disabled; it does not report an unconnected physical printer as idle. Counts are stored in `photos/.activity.json` under `DATA_DIR` and survive restarts and image deletion. Existing timestamp-ID portrait outputs are imported on first discovery using file modification time; source/print copies are excluded. Older failures cannot be reconstructed. Back up the activity file with your data. `STATUS_TIMEZONE` defaults to `America/New_York` for daily totals.

## Render deployment

The repository's `render.yaml` creates one paid `0.5c-512mb` Node web service with a 1 GB persistent disk mounted at `/opt/render/project/src/storage`. Both uploads and completed takeaway images are written beneath that mount.

The same service also accepts WebSocket connections at `/ws`. Render terminates TLS, so deployed clients connect with `wss://<service>.onrender.com/ws`; no second service or port is required. A kiosk broadcasts each movement to every phone connected to its photo-specific room. Clients reconnect after deploys or transient disconnects, the server sends heartbeat pings to retire stale sessions, and empty rooms are deleted after a short reconnect grace period.

1. Push the backend repository to GitHub.
2. In Render, choose **New → Blueprint** and connect `DaveSeidman/every.photobooth.be`.
3. During Blueprint creation, enter `FAL_KEY` when prompted.
4. Deploy, then copy the service's final `https://…onrender.com` URL.
5. In the frontend GitHub repository, create the Actions variable `VITE_API_URL` with that URL and enable GitHub Pages with **GitHub Actions** as the source.

`ALLOWED_ORIGINS` defaults in the Blueprint to `https://daveseidman.github.io`. Add a comma-separated origin if the kiosk later uses a custom domain. Render filesystems are otherwise ephemeral, and persistent disks require a paid service. A disk-backed service runs as a single instance and has brief downtime during deploys.

## API

- `GET /` — service information
- `GET /health` — Render health check
- `GET /config` — labels, features, and modes
- `GET /modes` — `every` and `posthog`
- `POST /submit` — multipart form with `photo`, `mode`, and `style`
- `GET /photos/:id.jpg` — finished takeaway image
- `GET /photos/:id-source.jpg` — the matching camera portrait
- `WS /ws` — kiosk/phone presence, synchronized portrait positions, and timed handoff events

Printing and animation are intentionally disabled.
