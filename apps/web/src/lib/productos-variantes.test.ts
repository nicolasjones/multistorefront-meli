import { describe, expect, it, vi } from 'vitest'
import {
  AVISO_VARIANTE_AGREGADA,
  type FilaVariante,
  ErrorGuardarVariantes,
  NOMBRE_VARIANTE_NUEVA,
  TEXTO_SIN_VARIANTES,
  campoDelError,
  erroresPorFila,
  guardarVariantes,
  leerVariantes,
  mensajeErrorVariantes,
  parametrosGuardarVariantes,
  stockTotalActivas,
  varianteNueva,
  variantesCambiaron,
} from './productos-variantes'

const NEGRO: FilaVariante = { clave: 'c1', id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigoBarras: '7790000000011', activa: true, stock: 4 }
const BLANCO: FilaVariante = { clave: 'c2', id: 'v2', nombre: 'Blanco', codigo: 'REM-1-B', codigoBarras: '', activa: true, stock: 3 }
const ROJO: FilaVariante = { clave: 'c3', id: null, nombre: 'Rojo', codigo: 'REM-1-R', codigoBarras: '', activa: true, stock: 2 }

describe('productos-variantes', () => {
  it('«Agregar variante» arma la fila por defecto del prototipo', () => {
    const fila = varianteNueva('5134a', [NEGRO], true)
    expect(fila).toMatchObject({ id: null, nombre: NOMBRE_VARIANTE_NUEVA, codigo: '5134a-2', codigoBarras: '', activa: true, stock: 0 })
    expect(fila.clave).not.toBe(NEGRO.clave)
  })

  it('«Agregar variante» no repite el código y usa VAR si el SKU está vacío', () => {
    const existente = { ...NEGRO, codigo: '5134a-2' }
    expect(varianteNueva('5134a', [NEGRO, existente], true).codigo).toBe('5134a-3')
    expect(varianteNueva('  ', [], true).codigo).toBe('VAR-1')
  })

  it('sin acceso a Stock la variante nace sin stock (null)', () => {
    expect(varianteNueva('A', [], false).stock).toBeNull()
  })

  it('el stock del producto es la suma de las variantes activas', () => {
    expect(stockTotalActivas([NEGRO, BLANCO, ROJO])).toBe(9)
    expect(stockTotalActivas([NEGRO, { ...BLANCO, activa: false }])).toBe(4)
    expect(stockTotalActivas([])).toBeNull()
    expect(stockTotalActivas([{ ...NEGRO, stock: null }])).toBeNull()
  })

  it('detecta cambios de contenido y de orden, e ignora espacios extremos', () => {
    expect(variantesCambiaron([NEGRO, BLANCO], [NEGRO, BLANCO])).toBe(false)
    expect(variantesCambiaron([{ ...NEGRO, nombre: ' Negro ' }], [NEGRO])).toBe(false)
    expect(variantesCambiaron([BLANCO, NEGRO], [NEGRO, BLANCO])).toBe(true)
    expect(variantesCambiaron([{ ...NEGRO, activa: false }], [NEGRO])).toBe(true)
    expect(variantesCambiaron([{ ...NEGRO, stock: 5 }], [NEGRO])).toBe(true)
    expect(variantesCambiaron([NEGRO], [NEGRO, BLANCO])).toBe(true)
  })

  it('lee la vista en el orden guardado y normaliza el código de barras nulo', async () => {
    const returns = vi.fn().mockResolvedValue({
      data: [{ id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigo_barras: null, activa: true, stock: 4 }],
      error: null,
    })
    const order = vi.fn(() => ({ returns }))
    const eq = vi.fn(() => ({ order }))
    const cliente = { from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })) }
    const filas = await leerVariantes(cliente as never, 'p1')
    expect(cliente.from).toHaveBeenCalledWith('v_producto_variantes')
    expect(eq).toHaveBeenCalledWith('producto_id', 'p1')
    expect(order).toHaveBeenCalledWith('orden', { ascending: true })
    expect(filas).toEqual([{ clave: 'v1', id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigoBarras: '', activa: true, stock: 4 }])
  })

  it('el payload de guardado respeta el orden y solo manda stock con acceso a Stock', () => {
    expect(parametrosGuardarVariantes('p1', '2026-01-01T00:00:00Z', [NEGRO, { ...BLANCO, codigo: ' REM-1-B ' }], true)).toEqual({
      p_producto: 'p1',
      p_actualizado_en: '2026-01-01T00:00:00Z',
      p_variantes: [
        { id: 'v1', nombre: 'Negro', codigo: 'REM-1-N', codigo_barras: '7790000000011', activa: true, stock: 4 },
        { id: 'v2', nombre: 'Blanco', codigo: 'REM-1-B', codigo_barras: null, activa: true, stock: 3 },
      ],
    })
    const sinStock = parametrosGuardarVariantes('p1', null, [{ ...NEGRO, id: null, stock: null }], false)
    expect(sinStock.p_actualizado_en).toBeNull()
    expect(sinStock.p_variantes[0]).not.toHaveProperty('id')
    expect(sinStock.p_variantes[0]).not.toHaveProperty('stock')
  })

  it('guarda por RPC y propaga el error', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await guardarVariantes({ rpc } as never, 'p1', '2026-01-01T00:00:00Z', [NEGRO], true)
    expect(rpc).toHaveBeenCalledWith('guardar_variantes_producto', expect.objectContaining({ p_producto: 'p1' }))
    const falla = { rpc: vi.fn().mockResolvedValue({ error: { code: '42501' } }) }
    await expect(guardarVariantes(falla as never, 'p1', null, [], false)).rejects.toEqual({ code: '42501' })
  })

  it('ErrorGuardarVariantes conserva el error de origen', () => {
    const origen = { code: '40001', message: 'x' }
    const error = new ErrorGuardarVariantes(origen)
    expect(error).toBeInstanceOf(Error)
    expect(error.origen).toBe(origen)
  })

  it('mapea el detalle de la RPC al campo', () => {
    expect(campoDelError({ details: 'codigo' })).toBe('codigo')
    expect(campoDelError({ details: 'codigo_barras' })).toBe('codigo_barras')
    expect(campoDelError({ details: 'stock' })).toBe('stock')
    expect(campoDelError({ details: 'otra_cosa' })).toBeNull()
    expect(campoDelError(null)).toBeNull()
  })

  it('el error de código repetido apunta a la fila que lo repite (FR-002)', () => {
    const error = { code: '23505', message: 'El código "rem-1-n" ya lo usa otra variante', details: 'codigo' }
    expect(erroresPorFila(error, [NEGRO, BLANCO])).toEqual({ c1: { campo: 'codigo', mensaje: error.message } })
  })

  it('el error de código de barras repetido apunta a su fila (FR-002)', () => {
    const error = { code: '23505', message: 'El código de barras "7790000000011" ya lo usa una variante', details: 'codigo_barras' }
    expect(erroresPorFila(error, [NEGRO, BLANCO])).toEqual({ c1: { campo: 'codigo_barras', mensaje: error.message } })
  })

  it('el error de stock apunta a la fila por nombre', () => {
    const error = { code: '22023', message: 'El stock de "Blanco" debe ser un entero de cero o más', details: 'stock' }
    expect(erroresPorFila(error, [NEGRO, BLANCO])).toEqual({ c2: { campo: 'stock', mensaje: error.message } })
  })

  it('un error sin fila identificable queda como error general', () => {
    expect(erroresPorFila({ code: '22023', message: 'La variante 1 necesita un nombre', details: 'nombre' }, [NEGRO])).toEqual({})
    expect(erroresPorFila({ code: '40001', message: 'x' }, [NEGRO])).toEqual({})
  })

  it('traduce los códigos de la base a mensajes para la persona', () => {
    const silenciar = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeErrorVariantes({ code: '40001' })).toMatch(/El producto fue modificado por otra persona/)
    expect(mensajeErrorVariantes({ code: '42501' })).toMatch(/No tenés permiso/)
    expect(mensajeErrorVariantes({ code: 'P0002' })).toBe('El producto ya no existe.')
    expect(mensajeErrorVariantes({ code: '23505', message: 'El código "X" ya lo usa otra variante' })).toBe('El código "X" ya lo usa otra variante')
    expect(mensajeErrorVariantes({ code: '22023', message: 'El código de barras "1" debe tener 13 dígitos (EAN-13)' })).toBe('El código de barras "1" debe tener 13 dígitos (EAN-13)')
    expect(mensajeErrorVariantes(new Error('boom'))).toBe('No pudimos guardar las variantes. Probá de nuevo.')
    silenciar.mockRestore()
  })

  it('los textos son los del prototipo', () => {
    expect(TEXTO_SIN_VARIANTES).toBe('Si no cargás variantes, el producto se vende como una sola unidad.')
    expect(AVISO_VARIANTE_AGREGADA).toBe('Variante agregada: completá código y stock')
  })
})
