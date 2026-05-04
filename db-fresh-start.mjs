import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const forceRun = process.argv.includes("--yes") || process.argv.includes("--force");

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!forceRun) {
  console.error("This command will apply the schema and clear reconciliation data.");
  console.error("Run: npm run fresh-start-db -- --yes");
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

  const schemaSql = await readFile(new URL("./schema/reconciliation.sql", import.meta.url), "utf8");
  const statements = schemaSql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  await client.query("begin");

  for (const statement of statements) {
    await client.query(statement);
  }

  await client.query(`
    truncate table
      public.topup_entries,
      public.reconciliation_ledger,
      public.debit_board,
      public.reconciliation_audits
    restart identity cascade
  `);

  await client.query("commit");
  console.log("Schema applied and reconciliation data cleared successfully.");
} catch (error) {
  await client.query("rollback").catch(() => {});
  console.error("Fresh-start setup failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}