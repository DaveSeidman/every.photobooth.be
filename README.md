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

The dashboard shows a single completed-portrait total, active jobs, failures, restart-interrupted jobs, AI configuration and uptime. Automatic printing is disabled until configured; it does not report an unconnected physical printer as idle. Job history is stored in `photos/.activity.json` under `DATA_DIR` and survives restarts and image deletion. Existing timestamp-ID portrait outputs are imported on first discovery using file modification time; source/print copies are excluded. Older failures cannot be reconstructed. Back up the activity file with your data. `STATUS_TIMEZONE` defaults to `America/New_York` for daily totals.

## Render deployment

The repository's `render.yaml` creates one paid `0.5c-512mb` Node web service with a 1 GB persistent disk mounted at `/opt/render/project/src/storage`. Both uploads and completed takeaway images are written beneath that mount.

The same service also accepts WebSocket connections at `/ws`. Render terminates TLS, so deployed clients connect with `wss://<service>.onrender.com/ws`; no second service or port is required. A kiosk broadcasts each movement to every phone connected to its photo-specific room. Clients reconnect after deploys or transient disconnects, the server sends heartbeat pings to retire stale sessions, and empty rooms are deleted after a short reconnect grace period.

1. Push the backend repository to GitHub.
2. In Render, choose **New → Blueprint** and connect `DaveSeidman/every.photobooth.be`.
3. During Blueprint creation, enter `FAL_KEY` when prompted.
4. Deploy, then copy the service's final `https://…onrender.com` URL.
5. In the frontend GitHub repository, create the Actions variable `VITE_API_URL` with that URL and enable GitHub Pages with **GitHub Actions** as the source.

`ALLOWED_ORIGINS` in the Blueprint includes `https://photobooth.lightboxlive.io` and `https://daveseidman.github.io`. The canonical custom domain is also included whenever an allowlist is configured, so existing Render services retaining the older GitHub-only environment value work after a code deploy. HTTP CORS and WebSocket handshakes share this resolved list. An unset/empty allowlist keeps the existing open local-development behavior. Render filesystems are otherwise ephemeral, and persistent disks require a paid service. A disk-backed service runs as a single instance and has brief downtime during deploys.

## API

- `GET /` — service information
- `GET /health` — Render health check
- `GET /config` — labels, features, and modes
- `GET /modes` — `every` and `posthog`
- `POST /submit` — multipart form with `photo`, `mode`, and `style`
- `GET /photos/:id.jpg` — finished takeaway image
- `GET /photos/:id-source.jpg` — the matching camera portrait
- `WS /ws` — kiosk/phone presence, synchronized portrait positions, and timed handoff events

Animation is disabled. Classic strip preparation and automatic print submission have separate settings (see below).

## Local print bridge

A separate service now lives in `../every-photobooth-print-server`, based on last year's War is Peace port-9000 printer bridge. See its README for dry-run setup, DNP/CUPS configuration, job status, and reprints. `utils/printUtils.js` contains the compatible upload helper, including optional bearer authentication and idempotency keys. The Every strip layout is implemented: original + selected emperor style + the other emperor style, with Thesis styling, logo, conference date, and “in Brooklyn”. The full strip is repeated side by side. Automatic printing remains disabled until the date and on-site printer setup are confirmed.

### Classic strip workflow

Set `PRINT_PREPARE_STRIPS=true` to prepare strips for new Every submissions. The original is uploaded once at `FAL_INPUT_WIDTH` (default 512 pixels wide, matching Halloween). Both treatments start in parallel from that upload. The chosen portrait returns to the kiosk as soon as it is saved; only sheet preparation waits for the other treatment. The saved original retains the full camera resolution for printing. That treatment is chosen from the other three styles. A custom prompt affects the selected portrait only. PostHog submissions do not start this pipeline.

The second treatment, strip PNG and 1200×1800 / 300 DPI sheet JPEG are stored as `<photoId>-alternate.jpg`, `-strip.png`, and `-print.jpg`. They do not count as additional guest sessions. Preparation state persists in `photos/.print-jobs`; backend restarts mark unfinished work interrupted instead of automatically spending another generation. A failed second treatment leaves the selected portrait and phone handoff usable.

- `GET /photos/:photoId/strip`: preparation state, selected/alternate styles and preview URLs.
- `POST /photos/:photoId/strip/rebuild`: rebuild an unsubmitted sheet from existing images, without another model call. Use this after changing conference details. Already-submitted jobs require an explicit reprint on the print server.
- `/status`: Classic photo strips table with status and links to prepared sheets.

Set `CONFERENCE_DATE` to the confirmed `YYYY-MM-DD` date, and `CONFERENCE_LOCATION` (default `in Brooklyn`). Until the date is confirmed, proofs say `DATE TO BE CONFIRMED` and the job remains `awaiting-date`. Invalid calendar dates are rejected at startup.

Automatic upload requires `PRINT_AUTO_SUBMIT=true`, a `PRINT_SERVER_URL` ending in `/print`, and a confirmed date. Set `PRINT_SERVER_TOKEN` to match the local server if authentication is configured. Uploads use a stable per-photo idempotency key. The print server's own dry-run mode is independent of backend submission.

`node scripts/preview-classic-strip.js [YYYY-MM-DD]` renders a sample proof in `docs/` using local sample artwork. It calls neither the image model nor the printer. The first sample image is a placeholder, not a real source photo.

### Speed settings

The live default is `fal-ai/nano-banana/edit`, matching the Halloween booth, with one JPEG per edit and two concurrent edits per Every session. `limit_generations=true` explicitly requests one generation; this is also the model's current default. `FAL_RESOLUTION` and `FAL_THINKING_LEVEL` are sent only when using `fal-ai/nano-banana-2/edit`, so they do not affect the default model. Model logs identify selected/alternate edits, provider queue status and elapsed generation time.

### Dashboard counts and print completion

The dashboard has one completed total and a **Reset completed total** button. Resetting changes a persisted counter baseline in `photos/.activity-counter.json`; it keeps the photos, history, failed totals and active jobs. Completed jobs after the reset count from zero, including jobs already in progress. The reset endpoint is `POST /api/status/completed/reset` with JSON `{ "reset": true }`. The daily API fields remain for compatibility, but there is no separate daily completed card.

Classic strip rows show the original camera thumbnail only. Every dashboard refresh checks the local print server for submitted jobs and persists their current status: Queued, Printing, Printed, Held, Stopped, Cancelled or Print failed. **Printed** means CUPS reports the job completed. A status lookup failure is shown as unavailable and never triggers another print. Existing submitted jobs are reconciled automatically without reprinting.

### Automatic local fallback

The local backend replaces a failed or slow AI treatment with a classic photo filter, independently for the selected and alternate portraits. The two emperor choices map to Cyan Ink and Ink & Paper local filters. These filters preserve the source photograph and do not invent marble bodies or temples. Results and print captions identify these as **Classic**. A successful AI treatment is retained when only the other treatment needs fallback.

`LOCAL_FALLBACK_ENABLED=true` is the default. The initial normal AI duration is `AI_NORMAL_DURATION_MS=17000`, giving a **34-second** fallback deadline. After at least three successful AI treatments, the deadline becomes twice the median of the last 20 successful treatment durations (upload, edit, image download and decode). Timing samples persist in `photos/.ai-latency.json`; failures and fallback rendering do not train that baseline. `/config` and `/api/status` expose the current policy under `generation`.

Provider errors, missing credentials, upload failures, image download/decoding failures and deadline expiry all use the saved original for local filtering. The deadline includes a shared source upload that stalls. The original remains at camera resolution, and local treatments render at up to 1024 px wide. Only a resolved AI-or-local result writes an output file. Aborted or late AI responses cannot replace the fallback or trigger another print. An already-running provider request may still consume provider credits even when the kiosk switches to its local result.

The browser refreshes the current policy before submission and leaves another 15 seconds for local rendering, saving and transport, so its previous 30-second timeout cannot cut off a valid local fallback. A mixed AI/classic strip uses the existing original-plus-two-treatments layout and the same idempotent print upload.

This fallback runs **on the event Mac** and needs no AI provider or internet connection. The iPad must still reach the local frontend/backend and printer computer over the local network. It does not provide a browser-only fallback if the Mac/backend itself is unreachable, or make cloud-hosted app endpoints reachable without internet. Phone downloads via cloud-hosted links also still need an available delivery path.

The preview `docs/classic-fallback-preview-print.jpg` shows a fully local strip. Provider failure and stalled-request tests use isolated mock editors and printer stubs; they do not spend AI credits or physically print.

The two guest choices are **Imperial Cyan** and **Imperial Ink**. Both edits run in parallel, and the strip always includes both. The supplied Imperial Ink prompt currently ends at “deep shadows…”; its remaining text is still needed.

The WebSocket protocol accepts `takeaway:interaction` events from joined phone clients and relays bounded gesture coordinates and share lifecycle actions only to kiosks in the same photo room. A single gesture owns the tablet mirror until its return animation finishes (2.4 seconds after detach, 650 ms after cancel; 8-second timeout while held). Other phones continue saving/sharing independently; their overlapping gestures cannot redirect the tablet. Closing the owning connection during a pull sends a cancellation. These events do not generate images or print.
