import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;
const expectedTables = [
  { schema: "public", name: "reconciliation_ledger" },
  { schema: "public", name: "debit_board" },
  { schema: "public", name: "reconciliation_audits" },
  { schema: "public", name: "topup_entries" },
];
const normalizedDatabaseUrl = databaseUrl?.includes("uselibpqcompat=true")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl?.includes("?") ? "&" : "?"}uselibpqcompat=true`;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = new Client({
  connectionString: normalizedDatabaseUrl,
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await client.connect();

  const healthResult = await client.query(
    "select current_database() as database, current_user as user_name, now() as server_time"
  );
  const tablesResult = await client.query(
    `select table_schema, table_name
     from information_schema.tables
     where table_schema not in ('pg_catalog', 'information_schema')
     order by table_schema, table_name
     limit 25`
  );
  const existingTables = new Set(
    tablesResult.rows.map((row) => `${row.table_schema}.${row.table_name}`)
  );
  const missingTables = expectedTables.filter(
    (table) => !existingTables.has(`${table.schema}.${table.name}`)
  );

  console.log("Database connection successful.");
  console.table(healthResult.rows);

  if (tablesResult.rowCount > 0) {
    console.log("Discovered tables:");
    console.table(tablesResult.rows);
  } else {
    console.log("No application tables found yet.");
  }

  if (missingTables.length > 0) {
    console.log("Missing reconciliation tables:");
    console.table(missingTables);
  } else {
    console.log("All reconciliation tables are present.");
  }
} catch (error) {
  console.error("Database check failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}