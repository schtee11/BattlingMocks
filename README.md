# MockDraft Showdown

Submit your 2027 NFL Round 1 mock draft and compete on a public leaderboard
once the real results are entered.

## Stack
- **Frontend:** React + Vite + Tailwind + React Router, dnd-kit, react-hot-toast, canvas-confetti
- **Backend:** Node 20 + Express + `pg`
- **Database:** PostgreSQL

## Local Development

### Server
```bash
cd server
cp .env.example .env   # fill in DATABASE_URL, ADMIN_KEY
npm install
npm run migrate        # create schema
npm run seed           # load prospects + draft order from /server/src/data
npm run dev            # http://localhost:3001
```

### Client
```bash
cd client
cp .env.example .env   # VITE_API_URL=http://127.0.0.1:3001
npm install
npm run dev            # http://localhost:5173
```

## Managing Data

The site runs one draft year at a time, set in **`server/src/config.js`** (`CURRENT_DRAFT_YEAR`, or the `DRAFT_YEAR` env var) and mirrored in **`client/src/lib/draftYear.js`** (`VITE_DRAFT_YEAR`), which also holds the draft date and location shown in the UI. Season data lives in `server/src/data/*-<year>.json`:

- **Prospects** — `prospects-<year>.json` (`rank`, `name`, `position`, `school`). Players are scoped by `draft_year`, so a new class never overwrites last year's rows (old mocks still point at them).
- **Round 1 order** — `draft-order-<year>.json`. Traded picks carry `original_team`. Editable in-app via the `/admin` Draft Order tab; pull the real 7-round order from ESPN with **Sync all rounds** once it's published.
- **Team needs / roster scores** — `team-needs-<year>.json`, `position-scores-<year>.json`. Editable in `/admin`.

On every deploy, `npm run migrate` fills in whatever the current year is missing from those files (prospects, R1 order, placeholder R2–R7 order, needs, roster scores) and, the first time it sees a new year, unlocks submissions. It never overwrites data that already exists, so admin edits survive redeploys. Mocks, actual picks, boards and prediction slots are all tagged with `draft_year`, so last season's leaderboard stays available (`/api/leaderboard?year=2026`).

### Rolling over to a new season
1. Add `prospects-`, `draft-order-`, `team-needs-` and `position-scores-<year>.json` under `server/src/data/`.
2. Bump `CURRENT_DRAFT_YEAR` in `server/src/config.js` and `client/src/lib/draftYear.js` (and the draft date/location there).
3. Deploy. Then optionally run **Sync all rounds** (with R1) and **Sync prospects from ESPN** in `/admin` to fill depth.

- **Admin panel:** navigate to `/admin`, enter your `ADMIN_KEY`.

## Scoring

- Correct player in Round 1: **5 pts**
- Right player, within 5 slots: **8 pts**
- Exact pick match: **15 pts**
- Miss: **0 pts**
- Max: **480 pts**

Run via `POST /api/admin/score` (or the Scoring tab in `/admin`). Idempotent — safe to re-run as more actuals come in.

## Deployment

### Railway (server)
- Start command: `npm start` (runs `migrate && node src/index.js`)
- Env vars: `DATABASE_URL`, `ADMIN_KEY`, `FRONTEND_URL`, `PORT`

### Netlify (client)
- Base directory: `client/`
- Build command: `npm run build`
- Publish dir: `dist`
- Env vars: `VITE_API_URL`
- SPA redirects handled by `netlify.toml`
