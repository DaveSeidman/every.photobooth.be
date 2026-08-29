# Every Photobooth Backend

Express service for the Every / Thesis: 2027 AI photobooth. It preserves the proven Halloween data flow while replacing its theme-specific copy, assets, prompts, URLs, and print-server assumptions.

## Flow

1. `POST /submit` receives one `photo` image.
2. The image is normalized and uploaded to FAL.
3. Two edits run in parallel using `variantAPrompt` and `variantBPrompt`.
4. The two edits and original are composed into a 600 × 1800 strip.
5. The response returns immediately with both generated image URLs, a `photoId`, and `printStatus: "coming-soon"`.
6. An optional transformed GIF is created in the background for the mobile takeaway.

Legacy request fields (`pastPrompt`, `futurePrompt`, `removePrompt`) and response fields (`past`, `future`) remain available during migration.

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Add a `FAL_KEY` before submitting a real photo. The health endpoint remains available without one.

## Endpoints

- `GET /` — health and AI configuration state
- `GET /config` — public labels, prompts, and feature flags
- `GET /prompts` — prompt configuration plus legacy aliases
- `POST /submit` — multipart upload; required field: `photo`
- `GET /photos/:filename` — completed strips, animations, and print files

## Theming hooks

- The default prompts create Thesis-inspired screenprinted speaker portraits: monochrome cutouts on electric blue or coral fields with rough swashes, halftone dots, paper grain, and imperfect registration.
- Replace `assets/strip-background.svg` or point `STRIP_BACKGROUND` at a different asset.
- Set prompt and label variables in `.env` for a different event or colorway.
- Adjust strip dimensions and panel placement with the `STRIP_*` and `PHOTO_*` variables.
- Printing is intentionally disabled; the frontend shows “Print edition coming soon.” The existing print utility is kept isolated for a later printer integration.

## Creative modes

`GET /modes` exposes the available experience modes. `POST /submit` accepts `mode` and `sessionId`; Oracle requests may include a JSON `oracleContext` with only short, consented fields (`firstName`, `city`, `industry`, `role`, `company`). No LinkedIn lookup is performed by this service. Designer requests may include `designerOptions` (`palette`, `brushX`, `brushY`, `texture`).

`every.one.in` keeps the cumulative master image in process memory and feeds it back into the next generation. A process restart clears the room; production should move this state to an expiring database/object store. `POST /sessions/reset` clears a session explicitly.

The PostHog mode is sponsor-inspired (sage desktop surface, event/funnel/retention motifs, orange accents) and does not copy logos or readable product UI.

## Deploy on Render (free)

Create a new Web Service from this repository and use the included `render.yaml` blueprint (or set `npm install` as the build command and `npm start` as the start command). Add `FAL_KEY` as a secret environment variable. The Starter plan is the always-on ~$7/month tier with 512 MB RAM; its local disk is still ephemeral across service replacement, so use it for the event session but move long-term photos/session state to object storage or a database later. Set `ENABLE_ANIMATION=true` only when you want the extra background animation work.
