import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".test-state");
mkdirSync(state, { recursive: true });
const databaseUrl = process.env.E2E_DATABASE_URL || "postgresql://football_e2e@127.0.0.1:55439/football_e2e?schema=public";
const parsedUrl = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsedUrl.hostname) || !/^\/football_e2e(?:_|$)/.test(parsedUrl.pathname)) {
  throw new Error("E2E only runs on a local database named football_e2e or football_e2e_*. Never use the application database.");
}
const env = { ...process.env, DATABASE_URL: databaseUrl, E2E_DATABASE_URL: databaseUrl, E2E_ACTIVE: "1",
  ADMIN_USERNAME: "e2e-admin", ADMIN_PASSWORD: randomUUID(), ADMIN_SESSION_TOKEN: randomUUID(),
  DEEPSEEK_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" };
delete env.NODE_ENV;
if (!env.PLAYWRIGHT_CHANNEL && process.platform === "win32" && existsSync("C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe")) {
  env.PLAYWRIGHT_CHANNEL = "msedge";
}
const pgBin = process.env.PG_BIN || (process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "");
const pg = (name) => pgBin ? path.join(pgBin, name + (process.platform === "win32" ? ".exe" : "")) : name;
function run(command, args, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: quiet ? "ignore" : "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)));
  });
}
const dataDir = path.join(state, "postgres");
let startedPostgres = false;
try {
  if (!process.env.E2E_DATABASE_URL) {
    if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
      await run(pg("initdb"), ["-D", dataDir, "-U", "football_e2e", "-A", "trust", "--encoding=UTF8", "--locale=C"], true);
    }
    await run(pg("pg_ctl"), ["-D", dataDir, "-l", path.join(state, "postgres.log"), "-o", "-h 127.0.0.1 -p 55439", "-w", "start"], true);
    startedPostgres = true;
    await run(pg("psql"), ["-h", "127.0.0.1", "-p", "55439", "-U", "football_e2e", "-d", "football_e2e", "-c", "SELECT 1"], true)
      .catch(() => run(pg("createdb"), ["-h", "127.0.0.1", "-p", "55439", "-U", "football_e2e", "football_e2e"], true));
  }
  await run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"]);
  await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (startedPostgres) await run(pg("pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "stop"], true);
}
