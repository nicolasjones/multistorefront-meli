import { useState } from 'react'
import { vi } from 'vitest'
import type { ProcesoMasivo } from '../../lib/procesosMasivos'

// Soporte común de las pruebas del centro de importaciones (F-IMP-01): un cliente de Supabase falso
// que registra cada consulta (tabla, filtros, rango) y responde con lo que la prueba configure.
export type LlamadaConsulta = { tabla: string; filtros: [string, unknown][]; rango: [number, number] | null }
type Respuesta = { data: unknown[] | null; count?: number | null; error: { message: string } | null }

export const falso = {
  llamadas: [] as LlamadaConsulta[],
  respuestas: {} as Record<string, (llamada: LlamadaConsulta) => Respuesta>,
  rpc: vi.fn(),
  filtro: vi.fn(),
}

export const supabaseFalso = {
  rpc: (...args: unknown[]) => falso.rpc(...args),
  from: (tabla: string) => {
    const llamada: LlamadaConsulta = { tabla, filtros: [], rango: null }
    falso.llamadas.push(llamada)
    const consulta: Record<string, unknown> = {
      select: () => consulta,
      order: () => consulta,
      eq: (columna: string, valor: unknown) => {
        llamada.filtros.push([columna, valor])
        return consulta
      },
      range: (desde: number, hasta: number) => {
        llamada.rango = [desde, hasta]
        return consulta
      },
      then: (ok: (valor: unknown) => unknown, ko: (razon: unknown) => unknown) =>
        Promise.resolve(falso.respuestas[tabla]?.(llamada) ?? { data: [], count: 0, error: null }).then(ok, ko),
    }
    return consulta
  },
}

export function reiniciarFalso() {
  falso.llamadas = []
  falso.respuestas = {}
  falso.rpc.mockReset()
  falso.filtro.mockReset()
}

export const EMPRESAS = [{ id: 'e-1', nombre: 'San Javucho' }, { id: 'e-2', nombre: 'Mundo JC' }]

// Reproduce el hook real (sigue la activa; la píldora la sobreescribe hasta que la activa cambie).
export function configurarFiltro(empresaActivaId: string | null = null) {
  falso.filtro.mockImplementation(() => {
    const [sobreescritura, setSobreescritura] = useState<{ base: string | null; valor: string | null } | null>(null)
    const valor = sobreescritura && sobreescritura.base === empresaActivaId ? sobreescritura.valor : empresaActivaId
    return {
      empresas: EMPRESAS,
      valor,
      cambiar: (id: string | null) => setSobreescritura({ base: empresaActivaId, valor: id }),
      empresaActivaId,
      cargando: false,
      hayError: false,
    }
  })
}

export function proceso(n: number, sobre: Partial<ProcesoMasivo> = {}): ProcesoMasivo {
  return {
    id: `p-${n}`,
    empresa_id: null,
    tipo: 'importacion',
    funcionalidad: 'catalogo',
    nombre: `Carga ${n}`,
    estado: 'completado',
    total: 100,
    procesados: 100,
    con_errores: 0,
    cancelacion_solicitada: false,
    detalle_truncado: false,
    creado_en: '2026-11-01T12:00:00Z',
    iniciado_en: '2026-11-01T12:00:05Z',
    finalizado_en: '2026-11-01T12:01:35Z',
    ...sobre,
  }
}

export function responderProcesos(filas: ProcesoMasivo[] | Error | (() => ProcesoMasivo[])) {
  falso.respuestas.procesos_masivos = () => {
    if (filas instanceof Error) return { data: null, count: null, error: { message: filas.message } }
    const lista = typeof filas === 'function' ? filas() : filas
    return { data: lista, count: lista.length, error: null }
  }
}

export function responderErrores(filas: { id: string; fila: number | null; columna?: string | null; referencia: string | null; motivo_sanitizado: string }[], total = filas.length) {
  falso.respuestas.procesos_masivos_errores = () => ({ data: filas, count: total, error: null })
}

export const consultasDe = (tabla: string) => falso.llamadas.filter((llamada) => llamada.tabla === tabla)
