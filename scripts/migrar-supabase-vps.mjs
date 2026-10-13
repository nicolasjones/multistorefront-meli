#!/usr/bin/env node
// Aplica las migraciones PENDIENTES a los Supabase SELF-HOSTED (dev/stg/prd) del VPS.
// Pensado para correr en el runner self-hosted con DOCKER_HOST=ssh://usuario@vps.
// Uso: node scripts/migrar-supabase-vps.mjs --env dev,stg,prd
//
// Por qué existe: el deploy de la app (Dokploy) NO aplica migraciones, y
// `migraciones-cloud.yml` apunta a Supabase Cloud (que no usamos). Sin esto,
// la base self-hosted queda atrás y el login (que consulta RPC de acceso)
// falla cerrado. Ver BUG-40.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIG = path.join(ROOT, "supabase", "migrations");
const ALL = ["dev", "stg", "prd"];

const argv = process.argv.slice(2);
const idx = argv.indexOf("--env");
const envArg = idx >= 0 ? argv[idx + 1] : (argv.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "");
const envs = (envArg ? envArg.split(",") : ALL).map((s) => s.trim()).filter(Boolean);
for (const e of envs) if (!ALL.includes(e)) throw new Error(`entorno inválido: ${e} (usar dev|stg|prd)`);

const dbContainer = (env) =>
  process.env[`SUPABASE_DB_CONTAINER_${env.toUpperCase()}`] ||
  `supabase_db_multistorefront-meli-supabase-${env}`;

function dockerExec(env, args, input) {
  return execFileSync("docker", ["exec", "-i", dbContainer(env), ...args], {
    encoding: "utf8",
    input: input ?? undefined,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });
}
const psql = (env, args, input) =>
  dockerExec(env, ["psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", ...args], input);

function applied(env) {
  const out = psql(env, ["-c", "select version from supabase_migrations.schema_migrations;"]);
  return new Set(out.split("\n").map((s) => s.trim()).filter(Boolean));
}

const files = readdirSync(MIG).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
let fallos = 0;
for (const env of envs) {
  console.log(`\n== ${env} (${dbContainer(env)}) ==`);
  let have;
  try {
    have = applied(env);
  } catch (e) {
    console.error(`  no se pudo consultar la base: ${String(e.message).split("\n")[0]}`);
    fallos++;
    continue;
  }
  const pending = files.filter((f) => !have.has(f.split("_")[0]));
  if (!pending.length) {
    console.log("  al día");
    continue;
  }
  for (const f of pending) {
    const version = f.split("_")[0];
    const name = f.replace(/^\d+_/, "").replace(/\.sql$/, "");
    try {
      psql(env, ["-f", "-"], readFileSync(path.join(MIG, f), "utf8"));
      psql(env, [
        "-c",
        `insert into supabase_migrations.schema_migrations(version,statements,name) values ('${version}','{}'::text[],'${name}') on conflict (version) do nothing;`,
      ]);
      console.log(`  ${version} OK`);
    } catch (e) {
      console.error(`  ${version} FALLO: ${String(e.message).split("\n").slice(-3).join(" ")}`);
      fallos++;
      break;
    }
  }
}
console.log(fallos ? `\n${fallos} entorno(s) con problemas.` : "\nMigraciones aplicadas.");
process.exit(fallos ? 1 : 0);
