# MockDraft Showdown

Submit your 2026 NFL Round 1 mock draft and compete on a public leaderboard
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

- **Prospects** live in `server/src/data/prospects-2026.json`. Edit, commit, then either run `npm run seed` or hit `POST /api/admin/import-prospects` (admin key header) to upsert into the DB. Existing players not in the JSON are left alone.
- **Draft order** lives in `server/src/data/draft-order-2026.json`. Editable in-app via the `/admin` Draft Order tab.
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
