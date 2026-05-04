import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const inputPath = process.argv[2];

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!inputPath) {
  console.error("Usage: npm run db-bulk -- path/to/payload.json");
  process.exit(1);
}

const normalizedDatabaseUrl = databaseUrl.includes("uselibpqcompat=true")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}uselibpqcompat=true`;

const payload = JSON.parse(await readFile(inputPath, "utf8"));
const ledgerRows = Array.isArray(payload.ledgerRows) ? payload.ledgerRows : [];
const debtRows = Array.isArray(payload.debtRows) ? payload.debtRows : [];
const auditRows = Array.isArray(payload.auditRows) ? payload.auditRows : [];

const client = new Client({
  connectionString: normalizedDatabaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query("begin");

  if (ledgerRows.length > 0) {
    const values = [];
    const placeholders = ledgerRows
      .map((row, index) => {
        const offset = index * 6;
        values.push(row.entry_time ?? null, row.user_ref, row.source, row.amount, row.processed_by, row.momo_ref ?? null);
        return `($${offset + 1}::timestamptz, $${offset + 2}::text, $${offset + 3}::text, $${offset + 4}::numeric, $${offset + 5}::text, $${offset + 6}::text)`;
      })
      .join(", ");

    await client.query(
      `insert into public.reconciliation_ledger (entry_time, user_ref, source, amount, processed_by, momo_ref)
       values ${placeholders}`,
      values
    );
  }

  if (debtRows.length > 0) {
    const values = [];
    const placeholders = debtRows
      .map((row, index) => {
        const offset = index * 5;
        values.push(row.user_ref, row.display_name, row.debt_amount, row.status ?? "open", row.priority_rank ?? 0);
        return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::numeric, $${offset + 4}::text, $${offset + 5}::integer)`;
      })
      .join(", ");

    await client.query(
      `insert into public.debit_board (user_ref, display_name, debt_amount, status, priority_rank)
       values ${placeholders}
       on conflict (user_ref) do update
       set display_name = excluded.display_name,
           debt_amount = excluded.debt_amount,
           status = excluded.status,
           priority_rank = excluded.priority_rank,
           updated_at = now()`,
      values
    );
  }

  if (auditRows.length > 0) {
    const values = [];
    const placeholders = auditRows
      .map((row, index) => {
        const offset = index * 6;
        values.push(row.audit_date ?? null, row.total_cash_in ?? 0, row.paystack_sync ?? 0, row.active_debt_board ?? 0, row.match_status ?? "MATCH", row.notes ?? null);
        return `($${offset + 1}::date, $${offset + 2}::numeric, $${offset + 3}::numeric, $${offset + 4}::integer, $${offset + 5}::text, $${offset + 6}::text)`;
      })
      .join(", ");

    await client.query(
      `insert into public.reconciliation_audits (audit_date, total_cash_in, paystack_sync, active_debt_board, match_status, notes)
       values ${placeholders}`,
      values
    );
  }

  await client.query("commit");
  console.log("Bulk data applied successfully.");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("Bulk database write failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}