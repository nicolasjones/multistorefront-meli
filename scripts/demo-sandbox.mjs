#!/usr/bin/env node
// Sandbox de onboarding: crea una organización/empresa demo, un usuario, clientes, productos y stock.
// SOLO contra un Supabase LOCAL. No toca datos reales.
//
// Requisitos (después de `pnpm dev:supabase`):
//   export SUPABASE_URL=http://localhost:54321
//   export SUPABASE_ANON_KEY=...            # supabase status -o env → ANON_KEY
//   export SUPABASE_SERVICE_ROLE_KEY=...    # supabase status -o env → SERVICE_ROLE_KEY
//
// Uso:
//   pnpm demo:seed            # crea/actualiza el demo
//   pnpm demo:seed -- --dry-run
import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const BASE = (process.env.SUPABASE_URL || "http://localhost:54321").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const HOST = (() => { try { return new URL(BASE).hostname; } catch { return ""; } })();
const LOCAL = ["localhost", "127.0.0.1", "host.docker.internal"].includes(HOST);
const EMAIL = "demo@local.test";
const PASSWORD = "Demo-Local1!";
const ORG = "Demo MSF";
const EMPRESA = "Tienda Demo";

if (!LOCAL) { console.error(`❌ ${URL} no es un Supabase local (${HOST}). Se aborta por seguridad.`); process.exit(1); }
if (dry) {
  console.log(`# Demo MSF (dry-run)\n- Supabase: ${BASE}\n- Organización: ${ORG}\n- Empresa: ${EMPRESA}\n- Usuario: ${EMAIL} / ${PASSWORD}\n- 3 clientes, 3 productos y stock inicial 10\n- No se ejecutó nada.`);
  process.exit(0);
}
if (!SERVICE) { console.error("❌ falta SUPABASE_SERVICE_ROLE_KEY (supabase status -o env)"); process.exit(1); }
if (!ANON) { console.error("❌ falta SUPABASE_ANON_KEY (supabase status -o env)"); process.exit(1); }

const headers = (token = SERVICE, schema = "public") => ({
  apikey: SERVICE,
  Authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "accept-profile": schema,
  "content-profile": schema,
});
async function call(path, { method = "GET", body, token = SERVICE, schema = "public", prefer } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...headers(token, schema), ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${typeof json === "string" ? json : JSON.stringify(json)}`);
  return json;
}
const first = async (path, schema = "public") => (await call(path, { schema }))?.[0] || null;

async function asegurarOrg() {
  const q = `organizaciones?nombre=eq.${encodeURIComponent(ORG)}&select=id&limit=1`;
  let org = await first(`/rest/v1/${q}`);
  if (!org) org = (await call("/rest/v1/organizaciones", { method: "POST", body: { nombre: ORG }, prefer: "return=representation" }))[0];
  return org;
}
async function asegurarEmpresa(orgId) {
  const q = `empresas?organizacion_id=eq.${orgId}&nombre=eq.${encodeURIComponent(EMPRESA)}&select=id&limit=1`;
  let e = await first(`/rest/v1/${q}`, "dominio");
  if (!e) e = (await call("/rest/v1/empresas", { method: "POST", schema: "dominio", body: { organizacion_id: orgId, nombre: EMPRESA }, prefer: "return=representation" }))[0];
  return e;
}
async function asegurarUsuario() {
  const r = await fetch(`${BASE}/auth/v1/admin/users`, { method: "POST", headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }) });
  if (r.ok) return (await r.json()).id;
  const list = await fetch(`${BASE}/auth/v1/admin/users?per_page=1000`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  if (!list.ok) throw new Error(`auth admin ${list.status}`);
  const u = (await list.json()).users?.find((x) => x.email === EMAIL);
  if (!u) throw new Error("no se pudo crear ni encontrar el usuario demo");
  return u.id;
}
async function asegurarCliente(orgId, nombre, correo) {
  const q = `clientes?organizacion_id=eq.${orgId}&nombre=eq.${encodeURIComponent(nombre)}&select=id&limit=1`;
  let c = await first(`/rest/v1/${q}`);
  if (!c) c = (await call("/rest/v1/clientes", { method: "POST", body: { organizacion_id: orgId, nombre, correo }, prefer: "return=representation" }))[0];
  return c;
}
async function asegurarProducto(orgId, nombre, sku, precio) {
  const q = `productos?organizacion_id=eq.${orgId}&sku=eq.${encodeURIComponent(sku)}&select=id&limit=1`;
  let p = await first(`/rest/v1/${q}`, "dominio");
  if (!p) p = (await call("/rest/v1/productos", { method: "POST", schema: "dominio", body: { organizacion_id: orgId, nombre, sku, precio_lista: precio }, prefer: "return=representation" }))[0];
  return p;
}
async function tokenDemo() {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error(`login demo ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

try {
  const org = await asegurarOrg();
  const empresa = await asegurarEmpresa(org.id);
  const userId = await asegurarUsuario();
  await call("/rest/v1/usuarios_organizacion", { method: "POST", body: [{ user_id: userId, organizacion_id: org.id, rol_id: "administrador" }], prefer: "resolution=merge-duplicates,return=representation" });
  const clientes = [
    ["Cliente Demo Uno", "uno@demo.local"],
    ["Cliente Demo Dos", "dos@demo.local"],
    ["Consumidor Final", null],
  ];
  for (const [n, c] of clientes) await asegurarCliente(org.id, n, c);
  const productos = [
    ["Producto Demo A", "DEMO-A", 1000],
    ["Producto Demo B", "DEMO-B", 2500],
    ["Producto Demo C", "DEMO-C", 500],
  ];
  const ids = [];
  for (const [n, sku, p] of productos) ids.push((await asegurarProducto(org.id, n, sku, p)).id);
  // Stock inicial 10 del primer producto: RPC con el JWT del usuario demo.
  const token = await tokenDemo();
  const motivos = await call(`/rest/v1/motivos_movimiento?organizacion_id=eq.${org.id}&activo=eq.true&select=id,aplica_a`, { schema: "dominio" });
  const motivo = (motivos || []).find((m) => Array.isArray(m.aplica_a) && m.aplica_a.includes("entrada"));
  if (motivo) {
    await call("/rest/v1/rpc/registrar_movimiento_stock", { method: "POST", token, schema: "dominio", body: { p_producto: ids[0], p_tipo: "entrada", p_cantidad: 10, p_motivo: motivo.id, p_nota: "Stock inicial demo" } });
  } else {
    console.warn("⚠️ no hay motivo de entrada; se omite el stock inicial");
  }
  console.log(`\n✅ Demo listo\n- URL: ${BASE}\n- Login: ${EMAIL} / ${PASSWORD}\n- Organización: ${ORG} · Empresa: ${EMPRESA}\n- 3 clientes · 3 productos · stock 10 en DEMO-A\n- Recorrido: /productos, /clientes, /stock, /actividad\n`);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
