import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ETIQUETA_TIPO_ACTIVIDAD } from './actividad'

// La columna «Tipo» y el filtro por tipo no pueden mostrar el nombre interno («Categoria creada»,
// «Cuenta_cobro creada», «Stock salida»). Este recorrido toma los tipos REALES que emiten las
// migraciones (y el frontend) y exige que cada uno tenga etiqueta con tildes: si una migración
// agrega un tipo y nadie lo etiqueta, el test falla.
// Vitest corre con cwd en `apps/web` (mismo criterio que `configAuth.test.ts`).
const RAIZ = resolve(process.cwd(), '../..')
const MIGRACIONES = resolve(RAIZ, 'supabase/migrations')

// Una llamada que deja un evento en `public.registro_actividad` (no la definición de la función).
const LLAMADA = /(?<!function )(?:private|public)\.\w*actividad\w*\s*\(/
// Un tipo de evento es `entidad.accion` en minúsculas (lo exige el CHECK de la tabla).
const LITERAL = /'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'(?!\s*\|\|)/g
// Prefijo de un tipo armado por concatenación: `'cliente.cuenta_' || p_accion`.
const PREFIJO = /'([a-z][a-z0-9_.]*)'\s*\|\|/g
// Un tipo que la función guarda en una variable antes de registrarlo (`v_tipo := '…'`).
const VARIABLE = /\b\w*tipo\w*\s*:=\s*'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/gi
// Los comentarios de línea no son código.
const COMENTARIO = /--[^\n]*/g

// Sufijos de los tipos que las migraciones arman por concatenación.
const SUFIJOS: Record<string, string[]> = {
  'cliente.cuenta_': ['creada', 'reactivada', 'restablecida', 'suspendida'],
  'stock.': ['ajuste', 'entrada', 'salida'],
}

// Los tipos que emite el panel (los de empresa) van por `public.registrar_actividad`.
const EMITE_EL_FRONTEND = resolve(RAIZ, 'apps/web/src/lib/eventosActividad.ts')

function tiposEmitidos(): string[] {
  const tipos = new Set<string>()
  for (const archivo of readdirSync(MIGRACIONES).filter((nombre) => nombre.endsWith('.sql'))) {
    const sql = readFileSync(resolve(MIGRACIONES, archivo), 'utf8').replace(COMENTARIO, '')
    for (const sentencia of sql.split(';')) {
      if (!LLAMADA.test(sentencia)) continue
      for (const [, tipo] of sentencia.matchAll(LITERAL)) tipos.add(tipo)
      for (const [, prefijo] of sentencia.matchAll(PREFIJO)) {
        const sufijos = SUFIJOS[prefijo]
        if (!sufijos) throw new Error(`Tipo armado por concatenación sin catálogo: «${prefijo}» (${archivo})`)
        for (const sufijo of sufijos) tipos.add(prefijo + sufijo)
      }
    }
    for (const [, tipo] of sql.matchAll(VARIABLE)) tipos.add(tipo)
  }
  const frontend = readFileSync(EMITE_EL_FRONTEND, 'utf8')
  for (const [, tipo] of frontend.matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g)) tipos.add(tipo)
  return [...tipos].sort()
}

describe('etiqueta de todos los tipos que emiten las migraciones', () => {
  const tipos = tiposEmitidos()

  it('el recorrido encuentra los tipos que emite la base', () => {
    expect(tipos.length).toBeGreaterThan(100)
  })

  it('todo tipo emitido tiene etiqueta propia', () => {
    expect(tipos.filter((tipo) => !ETIQUETA_TIPO_ACTIVIDAD[tipo])).toEqual([])
  })

  it('el mapa no trae etiquetas de tipos que nadie emite', () => {
    expect(Object.keys(ETIQUETA_TIPO_ACTIVIDAD).filter((tipo) => !tipos.includes(tipo))).toEqual([])
  })

  it('ninguna etiqueta muestra el formato interno', () => {
    expect(tipos.filter((tipo) => ETIQUETA_TIPO_ACTIVIDAD[tipo].includes('_'))).toEqual([])
  })
})
