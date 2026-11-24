import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createSignedUrl: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.createSignedUrl }) } },
}))

import {
  ErrorDocumento,
  ESTADOS_FACTURA_VIVA,
  MENSAJE_ERROR_IMPRESION,
  MENSAJE_NO_CONFIRMADA,
  MENSAJE_TARDA,
  documentosElegibles,
  esCancelacion,
  esperarDocumento,
  mensajeDeErrorImpresion,
  motivoNoImprimible,
  obtenerDocumento,
  solicitarDocumento,
  urlFirmadaDocumento,
  type DocumentoComprobante,
} from './ventasImpresion'

const documento = (cambios: Partial<DocumentoComprobante> = {}): DocumentoComprobante => ({
  id: 'd-1', comprobante_id: 'k-1', empresa_id: 'e-1', tipo_documento: 'factura', estado: 'pendiente', ruta: null,
  error: null, solicitado_en: '2026-10-25T10:00:00Z', generado_en: null, ...cambios,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('elegibilidad (FR-002, FR-011, FR-012)', () => {
  it('una factura confirmada ofrece factura y remito', () => {
    expect(documentosElegibles({ tipo: 'factura', estado: 'confirmada' })).toEqual(['factura', 'remito'])
  })

  it.each(['aceptado', 'en_proceso', 'armando', 'incompleto', 'cobrado', 'deuda'])(
    'una factura %s se imprime igual que una confirmada: cobrar no quita la impresión',
    (estado) => {
      expect(documentosElegibles({ tipo: 'factura', estado })).toEqual(['factura', 'remito'])
      expect(motivoNoImprimible({ tipo: 'factura', estado })).toBeNull()
    },
  )

  it.each(['borrador', 'pendiente', 'anulada'])('una factura en %s no ofrece nada y explica el motivo', (estado) => {
    expect(documentosElegibles({ tipo: 'factura', estado })).toEqual([])
    expect(motivoNoImprimible({ tipo: 'factura', estado })).toBe(MENSAJE_NO_CONFIRMADA)
  })

  it.each(['pendiente', 'aceptado', 'vencido'])('un presupuesto %s ofrece solo el presupuesto, sin factura ni remito (FR-021)', (estado) => {
    expect(documentosElegibles({ tipo: 'presupuesto', estado })).toEqual(['presupuesto'])
    expect(motivoNoImprimible({ tipo: 'presupuesto', estado })).toBeNull()
  })

  it('un presupuesto convertido en factura no ofrece nada', () => {
    expect(documentosElegibles({ tipo: 'presupuesto', estado: 'convertido' })).toEqual([])
  })
})

// Quita los comentarios SQL (`--` hasta fin de línea y `/* */`, también anidados) en una sola pasada, sin tocar el
// contenido de los literales entre comillas simples (un `--` dentro de `'...'` no es comentario; `''` escapa la comilla).
function sinComentariosSql(sql: string): string {
  let salida = ''
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      salida += sql.slice(i, j + 1)
      i = j + 1
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
    } else if (c === '/' && sql[i + 1] === '*') {
      let profundidad = 1
      i += 2
      while (i < sql.length && profundidad > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { profundidad++; i += 2 }
        else if (sql[i] === '*' && sql[i + 1] === '/') { profundidad--; i += 2 }
        else i++
      }
      salida += ' '
    } else {
      salida += c
      i++
    }
  }
  return salida
}

// Estados de cada predicado `v_c.estado not in (...)` que nombra `confirmada` (el de la factura; el del presupuesto no
// la nombra). Ignora comentarios y tolera saltos de línea, sangrías, espacios múltiples y mayúsculas.
function predicadosDeFactura(sql: string): string[][] {
  return [...sinComentariosSql(sql).matchAll(/v_c\.estado\s+not\s+in\s*\(([^)]*)\)/gi)]
    .filter((m) => m[1]?.includes("'confirmada'"))
    .map((m) => [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1] as string).sort())
}

describe('estados vivos de la factura frente a la base', () => {
  it('el parseo del predicado tolera líneas partidas y espacios múltiples', () => {
    const partido = "if v_c.estado\n    not   in\n  ('confirmada',\n 'cobrado') then"
    expect(predicadosDeFactura(partido)).toEqual([['cobrado', 'confirmada']])
    expect(predicadosDeFactura("IF V_C.ESTADO  NOT IN ('confirmada','deuda')")).toEqual([['confirmada', 'deuda']])
    // El predicado del presupuesto no es el de la factura.
    expect(predicadosDeFactura("if v_c.estado not in ('pendiente', 'aceptado') then")).toEqual([])
  })

  it('ignora predicados comentados y no se confunde con un -- dentro de un literal', () => {
    const real = "if v_c.estado not in ('confirmada', 'cobrado') then"
    const esperado = [['cobrado', 'confirmada']]
    expect(predicadosDeFactura(`-- if v_c.estado not in ('confirmada', 'x') then\n${real}`)).toEqual(esperado)
    expect(predicadosDeFactura(`/* v_c.estado not in ('confirmada', 'x') */ ${real}`)).toEqual(esperado)
    expect(predicadosDeFactura(`${real}\n-- v_c.estado not in ('confirmada', 'y')`)).toEqual(esperado)
    expect(predicadosDeFactura(`${real}\n/* v_c.estado not in ('confirmada', 'y') */`)).toEqual(esperado)
    expect(predicadosDeFactura(`/* uno\n  /* anidado */\n v_c.estado not in ('confirmada', 'x')\n*/\n${real}`)).toEqual(esperado)
    expect(predicadosDeFactura("if v_c.estado not in ('confirmada', 'a--b') then")).toEqual([['a--b', 'confirmada']])
  })

  it('cuenta dos predicados reales de factura', () => {
    const dos = "v_c.estado not in ('confirmada') v_c.estado not in ('confirmada', 'deuda')"
    expect(predicadosDeFactura(dos)).toHaveLength(2)
  })

  it('ESTADOS_FACTURA_VIVA es exactamente el conjunto del predicado de la última migración de solicitar_documento_comprobante', () => {
    // Desde la ubicación del archivo, no del directorio desde el que se lanza Vitest.
    const carpeta = path.resolve(__dirname, '../../../../supabase/migrations')
    const definen = readdirSync(carpeta)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => readFileSync(path.join(carpeta, f), 'utf8').includes('function public.solicitar_documento_comprobante'))
    const migracion = definen[definen.length - 1] as string
    const predicados = predicadosDeFactura(readFileSync(path.join(carpeta, migracion), 'utf8'))
    expect(predicados.length, `se esperaba un solo predicado \`v_c.estado not in (...)\` de la factura en ${migracion} y se encontraron ${predicados.length}`).toBe(1)
    const enSql = predicados[0] as string[]
    expect(enSql.length, `el predicado de la factura en ${migracion} no tiene estados`).toBeGreaterThan(0)
    expect(enSql).toEqual([...ESTADOS_FACTURA_VIVA].sort())
  })
})

describe('llamadas a la base', () => {
  it('solicita el documento con las RPC del contrato', async () => {
    mocks.rpc.mockResolvedValue({ data: documento(), error: null })
    expect((await solicitarDocumento('k-1', 'remito')).id).toBe('d-1')
    expect(mocks.rpc).toHaveBeenCalledWith('solicitar_documento_comprobante', { p_comprobante_id: 'k-1', p_tipo_documento: 'remito' })
  })

  it('propaga el error de la base', async () => {
    const error = { code: '42501', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(solicitarDocumento('k-1', 'factura')).rejects.toBe(error)
    await expect(obtenerDocumento('d-1')).rejects.toBe(error)
  })

  it('firma la URL del PDF con vigencia corta', async () => {
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://s/doc.pdf?t=1' }, error: null })
    expect(await urlFirmadaDocumento('o/e/c/d.pdf')).toBe('https://s/doc.pdf?t=1')
    expect(mocks.createSignedUrl).toHaveBeenCalledWith('o/e/c/d.pdf', 300)
  })
})

describe('esperarDocumento (FR-006)', () => {
  const esperar = vi.fn(async () => undefined)

  it('consulta hasta que el documento queda generado', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: documento(), error: null })
      .mockResolvedValueOnce({ data: documento({ estado: 'generado', ruta: 'o/e/c/d.pdf' }), error: null })
    const listo = await esperarDocumento('d-1', { esperar })
    expect(listo.ruta).toBe('o/e/c/d.pdf')
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(esperar).toHaveBeenCalledTimes(1)
  })

  it('un documento fallido lanza el motivo sanitizado', async () => {
    mocks.rpc.mockResolvedValue({ data: documento({ estado: 'fallido', error: 'No se pudo generar el documento' }), error: null })
    await expect(esperarDocumento('d-1', { esperar })).rejects.toThrow('No se pudo generar el documento')
  })

  it('pasado el tope avisa que tarda más de lo esperado', async () => {
    mocks.rpc.mockResolvedValue({ data: documento(), error: null })
    await expect(esperarDocumento('d-1', { esperar, intervaloMs: 1000, topeMs: 3000 })).rejects.toThrow(MENSAJE_TARDA)
    expect(mocks.rpc).toHaveBeenCalledTimes(3)
  })

  it('se cancela con la señal sin seguir consultando', async () => {
    const control = new AbortController()
    control.abort()
    const error = await esperarDocumento('d-1', { esperar, signal: control.signal }).catch((e: unknown) => e)
    expect(esCancelacion(error)).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})

describe('mensajeDeErrorImpresion', () => {
  it('traduce permiso, inexistente y validaciones de la base', () => {
    expect(mensajeDeErrorImpresion({ code: '42501' })).toMatch(/No tenés permiso/)
    expect(mensajeDeErrorImpresion({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeErrorImpresion({ code: '22023', message: 'La factura tiene que estar confirmada para imprimirla' })).toBe(
      'La factura tiene que estar confirmada para imprimirla',
    )
    expect(mensajeDeErrorImpresion({ code: 'P0001', hint: 'sin_conexion', message: 'La impresión de documentos todavía no está habilitada' })).toMatch(
      /todavía no está habilitada/,
    )
  })

  it('un error desconocido no filtra detalle técnico', () => {
    expect(mensajeDeErrorImpresion({ code: 'XX000', message: 'relation dominio.x does not exist' })).toBe(MENSAJE_ERROR_IMPRESION)
    expect(mensajeDeErrorImpresion(new ErrorDocumento('motivo propio'))).toBe('motivo propio')
  })
})
