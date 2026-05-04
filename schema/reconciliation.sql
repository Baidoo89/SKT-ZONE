create extension if not exists pgcrypto;

create table if not exists public.reconciliation_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_time timestamptz not null default now(),
  user_ref text not null,
  source text not null check (source in ('Paystack', 'Manual Admin', 'Debt Clearance')),
  amount numeric(14, 2) not null check (amount > 0),
  processed_by text not null,
  momo_ref text unique,
  created_at timestamptz not null default now()
);

create index if not exists reconciliation_ledger_entry_time_idx
  on public.reconciliation_ledger (entry_time desc);

create table if not exists public.debit_board (
  id uuid primary key default gen_random_uuid(),
  user_ref text not null,
  display_name text not null,
  debt_amount numeric(14, 2) not null check (debt_amount >= 0),
  status text not null default 'open' check (status in ('open', 'partial', 'cleared')),
  priority_rank integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists debit_board_user_ref_key
  on public.debit_board (user_ref);

create index if not exists debit_board_status_priority_idx
  on public.debit_board (status, priority_rank desc);

create table if not exists public.reconciliation_audits (
  id uuid primary key default gen_random_uuid(),
  audit_date date not null default current_date,
  total_cash_in numeric(14, 2) not null default 0,
  paystack_sync numeric(5, 2) not null default 0,
  active_debt_board integer not null default 0,
  match_status text not null default 'MATCH',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.topup_entries (
  id uuid primary key default gen_random_uuid(),
  user_ref text not null,
  amount numeric(14, 2) not null check (amount > 0),
  momo_ref text not null unique,
  credited_by text not null,
  created_at timestamptz not null default now()
);
