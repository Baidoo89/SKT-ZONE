import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const forceReset = process.argv.includes("--yes") || process.argv.includes("--force");

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!forceReset) {
  console.error("This command wipes reconciliation data.");
  console.error("Run: npm run reset-db -- --yes");
  process.exit(1);
}

const normalizedDatabaseUrl = databaseUrl.includes("uselibpqcompat=true")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}uselibpqcompat=true`;

const client = new Client({
  connectionString: normalizedDatabaseUrl,
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await client.connect();
  await client.query("begin");

  await client.query(`
    truncate table
      public.topup_entries,
      public.reconciliation_ledger,
      public.debit_board,
      public.reconciliation_audits
    restart identity cascade
  `);

  await client.query("commit");
  console.log("Reconciliation data cleared successfully.");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("Database reset failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}