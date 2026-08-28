# Every Photobooth Backend

Express service for a configurable AI photobooth. It preserves the proven Halloween data flow while removing theme-specific copy, assets, prompts, URLs, and print-server assumptions.

## Flow

1. `POST /submit` receives one `photo` image.
2. The image is normalized and uploaded to FAL.
3. Two edits run in parallel using `variantAPrompt` and `variantBPrompt`.
4. The two edits and original are composed into a 600 × 1800 strip.
5. The response returns immediately with both generated image URLs and a `photoId`.
6. A two-up 1200 × 1800 print file is created in the background and sent only when `PRINT_SERVER_URL` is configured.
7. An optional transformed GIF is created in the background for the mobile takeaway.

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

- Replace `assets/strip-background.svg` or point `STRIP_BACKGROUND` at a different asset.
- Set prompt and label variables in `.env`.
- Adjust strip dimensions and panel placement with the `STRIP_*` and `PHOTO_*` variables.
- Set `PRINT_SERVER_URL` to the new event print relay. Printing is safe-by-default and disabled when it is blank.
