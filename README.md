# MockDraft Showdown

Web app for submitting 2026 NFL Round 1 mock drafts and competing on a public leaderboard once real results are entered.

## Stack
- **Frontend:** React + Vite + Tailwind (deploy: Netlify)
- **Backend:** Node.js + Express + `pg` (deploy: Railway)
- **Database:** PostgreSQL (Railway)

## Local Development

### Server
```bash
cd server
cp .env.example .env   # fill in DATABASE_URL, ADMIN_KEY
npm install
npm run migrate
npm run seed
npm run dev
```

### Client
```bash
cd client
cp .env.example .env   # set VITE_API_URL=http://localhost:3001
npm install
npm run dev
```

## Deployment

### Railway (server)
- Start command: `npm run migrate && npm start`
- Env: `DATABASE_URL`, `ADMIN_KEY`, `FRONTEND_URL`, `PORT`

### Netlify (client)
- Build command: `npm run build`
- Publish dir: `dist`
- Env: `VITE_API_URL`
- SPA redirects handled by `netlify.toml`

## Scoring
- Correct player in R1: **5 pts**
- Right player, within 5 slots: **8 pts**
- Exact pick match: **15 pts**
- Miss: **0 pts**
- Max: **480 pts**

Run via `POST /api/admin/score` with `X-Admin-Key` header.
