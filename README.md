# Dataflow Admin Reconciliation Hub

Production-ready Next.js reconciliation dashboard for VTU operations (MTN, Telecel, AirtelTigo) with Neon/PostgreSQL backend.

## Features

- Live reconciliation dashboard UI
- Manual wallet top-up workflow
- Debt clearance workflow
- End-of-day reconciliation snapshots
- Recent audit history table
- Session-based admin login/logout
- Bulk scripts for schema/bootstrap/reporting
- Optional action-key write protection fallback

## Environment

Copy `.env.example` to `.env.local` and set values:

- `DATABASE_URL`: PostgreSQL connection string
- `ADMIN_USERNAME`: admin login username (recommended)
- `ADMIN_PASSWORD`: admin login password (recommended)
- `ADMIN_SESSION_SECRET`: signing secret for admin session cookie (recommended)
- `ADMIN_ACTION_KEY` (optional fallback): enables header-based writes for scripts/non-UI clients

## Install

```bash
npm install
```

## Database Setup

Apply schema:

```bash
npm run apply-schema
```

Connectivity check:

```bash
npm run check-db
```

Summary report:

```bash
npm run db-report
```

## Run App

Development:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## API Contract

### `GET /api/reconciliation`
Returns dashboard snapshot including:

- ledger rows
- debt board entries
- latest audit
- audit history
- totals
- settings (`actionAuthEnabled`, `sessionAuthEnabled`)

### `POST /api/reconciliation`
Actions:

- `topup`
- `clearDebt`
- `reconcile`

Authorization for write actions:

- preferred: authenticated admin session cookie
- fallback: `x-admin-key: <ADMIN_ACTION_KEY>` when action key is configured

### `GET /api/auth/session`
Returns session auth mode and current admin session state.

### `POST /api/auth/login`
Request body:

- `username`
- `password`

Sets an HTTP-only admin session cookie on success.

### `POST /api/auth/logout`
Clears the admin session cookie.

## Bulk Import Script

Use `sample-bulk.payload.json` as reference:

```bash
npm run db-bulk -- sample-bulk.payload.json
```
