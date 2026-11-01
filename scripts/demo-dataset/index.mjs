#!/usr/bin/env node
// Dataset de demostración de MSF: San Javucho y Mundo JC (repuestos y accesorios de videojuegos, service técnico).
//
//   pnpm demo:dataset                      # crea todo (falla si la organización demo ya existe)
//   pnpm demo:dataset -- --reset           # borra la organización demo y la recrea
//   pnpm demo:dataset -- --solo=02,03      # solo esos módulos, sobre una organización ya creada
//   pnpm demo:dataset -- --hasta=02        # módulos hasta el 02 inclusive (--desde=03: del 03 en adelante)
//   pnpm demo:dataset -- --listar          # muestra los módulos
//
// Variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, DEMO_HOSTS_PERMITIDOS (hosts no locales).
// Ver docs/dataset-demo.md.
import { readdirSync } from 'node:fs'
import { configurar, crearAdmin, iniciarSesion } from './lib/cliente.mjs'
import { crearAzar } from './lib/azar.mjs'
import { ORGANIZACION, PASSWORD, USUARIOS, correoDe } from './datos/base.mjs'
import { cargarBase } from './lib/contexto.mjs'

const args = process.argv.slice(2)
const bandera = (n) => args.includes(`--${n}`)
const valor = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1]

const dirModulos = new URL('./modulos/', import.meta.url)
const archivos = readdirSync(dirModulos).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort()
const modulos = []
for (const f of archivos) modulos.push({ id: f.slice(0, 2), ...(await import(new URL(f, dirModulos))) })

if (bandera('listar')) { for (const m of modulos) console.log(`${m.id}  ${m.nombre}`); process.exit(0) }

const cfg = configurar()
const admin = crearAdmin(cfg)
const sesiones = new Map()
const ctx = {
  cfg, admin, azar: crearAzar(), orgId: null, usuarios: {}, empresas: {},
  log: (m) => console.log(`   · ${m}`),
  async sesion(clave) {
    if (!sesiones.has(clave)) sesiones.set(clave, await iniciarSesion(cfg, correoDe(clave), PASSWORD))
    return sesiones.get(clave)
  },
}

async function reset() {
  // Ojo: si ya hay ingresos de mercadería, ventas, etc., el borrado por API falla (FK RESTRICT): usar `demo.sh --reset`,
  // que borra por SQL (sql/00-borrar-organizacion.sql).
  const orgs = await admin.leer(`organizaciones?nombre=eq.${encodeURIComponent(ORGANIZACION)}&select=id`)
  for (const o of orgs) {
    await admin.borrar(`usuarios_organizacion?organizacion_id=eq.${o.id}`)
    await admin.borrar(`organizaciones?id=eq.${o.id}`)
    console.log(`organización ${o.id} borrada`)
  }
  for (const u of USUARIOS) { const p = await admin.buscarUsuario(correoDe(u.clave)); if (p) await admin.borrarUsuario(p.id) }
}

// Carga ids de una organización ya sembrada, para correr módulos sueltos.
async function cargarContexto() {
  const [org] = await admin.leer(`organizaciones?nombre=eq.${encodeURIComponent(ORGANIZACION)}&select=id`)
  if (!org) throw new Error('No existe la organización demo: corré primero el módulo 01.')
  ctx.orgId = org.id
  for (const u of USUARIOS) ctx.usuarios[u.clave] = { correo: correoDe(u.clave), rol: u.rol }
  await cargarBase(ctx)
}

if (bandera('reset')) await reset()
const solo = valor('solo')?.split(',')
const desde = valor('desde'), hasta = valor('hasta')
const elegidos = modulos.filter((m) => (!solo || solo.includes(m.id)) && (!desde || m.id >= desde) && (!hasta || m.id <= hasta))
// Si el primero a correr no es el 01, la organización ya existe: se carga su contexto desde la base.
if (elegidos.length && elegidos[0].id !== '01') await cargarContexto()
console.log(`Dataset demo → ${cfg.url}`)
for (const m of elegidos) {
  console.log(`\n[${m.id}] ${m.nombre}`)
  const t0 = Date.now()
  await m.sembrar(ctx)
  console.log(`   ✓ ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}
console.log('\nListo.')
