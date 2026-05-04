import { readFile } from "node:fs/promises";
import { Client } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const normalizedDatabaseUrl = databaseUrl.includes("uselibpqcompat=true")
  ? databaseUrl
  : `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}uselibpqcompat=true`;

const schemaSql = await readFile(new URL("./schema/reconciliation.sql", import.meta.url), "utf8");
const statements = schemaSql
  .split(/;\s*(?:\r?\n|$)/)
  .map((statement) => statement.trim())
  .filter(Boolean);

const client = new Client({
  connectionString: normalizedDatabaseUrl,
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await client.connect();

  for (const statement of statements) {
    await client.query(statement);
  }

  console.log("Starter reconciliation schema applied successfully.");
} catch (error) {
  console.error("Schema bootstrap failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}