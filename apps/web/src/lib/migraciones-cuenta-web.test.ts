import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const raiz = resolve(__dirname, '../../../..')
const migraciones = readdirSync(resolve(raiz, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))

const ESPERADAS = [
  '20261204151000_cuentas_cliente.sql',
  '20261204151100_cuentas_cliente_rpc.sql',
  '20261204151200_cuentas_cliente_actividad.sql',
  '20261205120000_acceso_cliente_por_dominio.sql',
  '20261205120100_buscar_clientes_cuenta_web.sql',
]
// Versiones previas (renombradas por colisión con la épica): no deben reaparecer.
const VIEJAS = /^(2026120210\d{4}|20261204151[34]00|20261202110[01]00)_/

describe('migraciones de la cuenta web del cliente (cierre MSF-237)', () => {
  it('existen con las versiones renombradas y ninguna versión vieja', () => {
    for (const f of ESPERADAS) expect(migraciones).toContain(f)
    expect(migraciones.filter((f) => VIEJAS.test(f))).toEqual([])
  })

  it('cada versión de migración es única', () => {
    const versiones = migraciones.map((f) => f.split('_')[0])
    expect(new Set(versiones).size).toBe(versiones.length)
  })

  it('las dos últimas van después de las migraciones de precios de la épica', () => {
    const ultimaPrecios = migraciones.filter((f) => /precio|precios/.test(f)).map((f) => f.split('_')[0]).sort().pop()!
    for (const f of ESPERADAS.slice(3)) expect(f.split('_')[0] > ultimaPrecios).toBe(true)
  })

  it.each(['plan.md', 'tasks.md'])('%s no cita versiones viejas y cita las vigentes', (archivo) => {
    const texto = readFileSync(resolve(raiz, 'specs/20261024-051500-cuenta-web-del-cliente', archivo), 'utf8')
    expect(texto).not.toMatch(/2026120210\d{4}|20261204151[34]00|20261202110[01]00/)
    expect(texto).toContain('20261205120000')
  })
})
