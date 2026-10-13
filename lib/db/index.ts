import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const g = globalThis as unknown as { __pg?: ReturnType<typeof postgres> };

/** Only call when DATABASE_URL is set (lib/data.ts checks this). */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  g.__pg ??= postgres(url, { max: 5, prepare: false });
  return drizzle(g.__pg, { schema });
}

export { schema };
