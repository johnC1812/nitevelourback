# NiteVelour (Cloudflare Pages Direct Upload)

This project is designed for **Wrangler Direct Upload** (no GitHub integration).

## Quick start

### 1) Install dependencies (once)
```powershell
npm install
```

### 2) Configure CrakRevenue Cam Models API (optional but recommended)
Create a `.env` file in the project root (do **not** deploy this file):

```env
CRAK_API_KEY="YOUR_X_API_KEY"
CRAK_TOKEN="YOUR_TOKEN"
CRAK_UA="nitevelour.com"
```

Then run:
```powershell
npm run sync:cams
```

This writes `data/performers.json`.

If you prefer not to use `.env`, you can set PowerShell env vars instead:
```powershell
$env:CRAK_API_KEY="..."
$env:CRAK_TOKEN="..."
$env:CRAK_UA="nitevelour.com"
npm run sync:cams
```

### 3) Build
```powershell
npm run build
```

### 4) Deploy
```powershell
npx wrangler pages deploy dist --project-name nitevelour
```

or:
```powershell
npm run deploy
```

## Smartlink redirect endpoints

- `/go/cams` -> CrakRevenue cam smartlink
- `/go/dating` -> Jerkmate dating smartlink

Edit `functions/go/[offer].ts` to change destinations.

## Notes

- Model/list pages are generated only if `data/performers.json` exists.
- Brand filter defaults live in `site.config.json` under `crak.brands` (e.g., `chaturbate, stripchat, awempire, streamate`).
