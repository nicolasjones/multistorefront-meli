import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../..')
const migraciones = readdirSync(resolve(raiz, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))

const ESPERADAS = [
  '20261204151000_cuentas_cliente.sql',
  '20261204151100_cuentas_cliente_rpc.sql',
  '20261204151200_cuentas_cliente_actividad.sql',
  '20261204151300_acceso_cliente_por_dominio.sql',
]

describe('migraciones de la cuenta web del cliente (cierre MSF-237)', () => {
  it('existen con las versiones renombradas y ninguna versión vieja', () => {
    for (const f of ESPERADAS) expect(migraciones).toContain(f)
    expect(migraciones.filter((f) => f.startsWith('2026120210'))).toEqual([])
  })

  it('cada versión de migración es única', () => {
    const versiones = migraciones.map((f) => f.split('_')[0])
    expect(new Set(versiones).size).toBe(versiones.length)
  })

  it('tasks.md y plan.md citan las versiones vigentes', () => {
    const dir = resolve(raiz, 'specs/20261024-051500-cuenta-web-del-cliente')
    const texto = ['tasks.md', 'plan.md'].map((f) => readFileSync(resolve(dir, f), 'utf8')).join('\n')
    expect(texto).not.toMatch(/2026120210\d{4}/)
    expect(texto).not.toMatch(/·\s{2,}\d/)
    for (const f of ESPERADAS) expect(texto).toContain(f.split('_')[0])
  })
})
