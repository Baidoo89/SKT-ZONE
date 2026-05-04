import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const normalizedDatabaseUrl = databaseUrl.includes("uselibpqcompat=true")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}uselibpqcompat=true`;

const client = new Client({
  connectionString: normalizedDatabaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const ledgerSummary = await client.query(
    `select source, count(*)::int as entries, coalesce(sum(amount), 0) as total_amount
     from public.reconciliation_ledger
     group by source
     order by source`
  );
  const topDebtors = await client.query(
    `select user_ref, display_name, debt_amount, status, priority_rank
     from public.debit_board
     order by debt_amount desc, priority_rank desc, created_at asc
     limit 5`
  );
  const latestAudit = await client.query(
    `select audit_date, total_cash_in, paystack_sync, active_debt_board, match_status, notes
     from public.reconciliation_audits
     order by audit_date desc, created_at desc
     limit 1`
  );

  console.log("Ledger summary by source:");
  console.table(ledgerSummary.rows);

  console.log("Top debtors:");
  console.table(topDebtors.rows);

  if (latestAudit.rowCount > 0) {
    console.log("Latest audit:");
    console.table(latestAudit.rows);
  } else {
    console.log("No audit records found yet.");
  }
} catch (error) {
  console.error("Database report failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}