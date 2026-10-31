import { env } from "../config.js";
import { Checkpoints } from "./checkpoints.js";
if (!env.AGENT_DATABASE_URL) throw new Error("AGENT_DATABASE_URL is required");
const db = new Checkpoints(env.AGENT_DATABASE_URL);
try { await db.migrate(); console.info("Companion checkpoint schema migrated"); } finally { await db.close(); }
