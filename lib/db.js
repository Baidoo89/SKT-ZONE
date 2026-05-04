import { Pool } from "pg";

let pool;

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!pool) {
    const connectionString = process.env.DATABASE_URL.includes("uselibpqcompat=true")
      ? process.env.DATABASE_URL
      : `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes("?") ? "&" : "?"}uselibpqcompat=true`;

    pool = new Pool({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return pool;
}
