import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  avisarFaltantesVenta,
  estadoStockHoy,
  etiquetaAviso,
  mensajeResultadoAvisoVenta,
  TEXTO_AVISO_POR_DEFECTO,
  type ResultadoAvisoVenta,
  listarFaltantes,
  mensajeDeErrorFaltantes,
  registrarFaltantes,
  unidadesDisponibles,
  validarCantidadFaltante,
  MENSAJE_CANTIDAD_CERO,
  MENSAJE_CANTIDAD_EXCEDE,
  MENSAJE_CANTIDAD_NO_NUMERO,
  MENSAJE_CANTIDAD_VACIA,
  MENSAJE_CONFLICTO,
  MENSAJE_ERROR_LISTADO,
  MENSAJE_ERROR_REGISTRAR,
  MENSAJE_FUERA_DE_ESTADO,
  MENSAJE_SIN_PERMISO,
  type FaltanteVenta,
} from './ventasFaltantes'

const fila = (cambios: Partial<FaltanteVenta> = {}): FaltanteVenta => ({
  id: 'f-1',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente: 'Cliente Uno',
  producto_id: 'p-1',
  producto: 'Joystick',
  sku: 'JOY-1',
  cantidad_faltante: 3,
  linea_orden: 1,
  comprobante_id: 'c-1',
  comprobante: '0003-00001251',
  fecha: '2026-10-05',
  desde: '2026-10-07T10:00:00Z',
  stock_estado: 'sin_stock',
  stock_disponible: 0,
  aviso: 'sin_avisar',
  aviso_en: null,
  ...cambios,
})

describe('ventasFaltantes · listado (FR-043, FR-044)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('pide el listado a la RPC con el filtro de tienda y la página', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarFaltantes({ empresaId: 'e-1', pagina: 2, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', {
      p_empresa_id: 'e-1',
      p_pagina: 2,
      p_tamano: 10,
      p_aviso: null,
    })
  })

  it('sin filtro de tienda pide todas las empresas accesibles', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', {
      p_empresa_id: null,
      p_pagina: 1,
      p_tamano: 10,
      p_aviso: null,
    })
  })

  it('normaliza los números de la fila y trae el total del filtro', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...fila(), cantidad_faltante: '3', linea_orden: '1', stock_disponible: '12', filas: '7' }],
      error: null,
    })
    const pagina = await listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })
    expect(pagina.total).toBe(7)
    expect(pagina.faltantes).toHaveLength(1)
    expect(pagina.faltantes[0].cantidad_faltante).toBe(3)
    expect(pagina.faltantes[0].linea_orden).toBe(1)
    expect(pagina.faltantes[0].stock_disponible).toBe(12)
  })

  it('sin filas no hay total', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    const pagina = await listarFaltantes({ empresaId: null, pagina: 3, tamano: 10 })
    expect(pagina.faltantes).toEqual([])
    expect(pagina.total).toBe(0)
  })

  it('propaga el error de la RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'sin permiso' } })
    await expect(listarFaltantes({ empresaId: null, pagina: 1, tamano: 10 })).rejects.toBeTruthy()
  })
})

describe('ventasFaltantes · «Stock hoy»', () => {
  it('rotula los estados de Stock con su variante', () => {
    expect(estadoStockHoy('sin_stock')).toEqual({ texto: 'Sin stock', variante: 'error' })
    expect(estadoStockHoy('stock_bajo')).toEqual({ texto: 'Stock bajo', variante: 'aviso' })
    expect(estadoStockHoy('disponible')).toEqual({ texto: 'Disponible', variante: 'exito' })
  })

  it('sin estado no inventa uno', () => {
    expect(estadoStockHoy(null)).toEqual({ texto: 'Sin dato', variante: 'neutral' })
    expect(estadoStockHoy(undefined)).toEqual({ texto: 'Sin dato', variante: 'neutral' })
  })

  it('las unidades disponibles en singular y plural', () => {
    expect(unidadesDisponibles(1)).toBe('1 unidad')
    expect(unidadesDisponibles(12)).toBe('12 unidades')
    expect(unidadesDisponibles(null)).toBe('—')
  })
})

describe('ventasFaltantes · registro de faltantes (FR-047)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('manda línea y cantidad a la RPC con el bloqueo optimista', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await registrarFaltantes({
      comprobanteId: 'c-1',
      actualizadoEn: '2026-10-07T10:00:00Z',
      faltantes: [
        { linea_orden: 1, cantidad: 3 },
        { linea_orden: 2, cantidad: 1 },
      ],
    })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_faltantes_despacho', {
      p_id: 'c-1',
      p_faltantes: [
        { linea_orden: 1, cantidad: 3 },
        { linea_orden: 2, cantidad: 1 },
      ],
      p_actualizado_en: '2026-10-07T10:00:00Z',
    })
  })

  it('valida la cantidad contra lo pedido en la línea', () => {
    expect(validarCantidadFaltante('', 5)).toBe(MENSAJE_CANTIDAD_VACIA)
    expect(validarCantidadFaltante('muchas', 5)).toBe(MENSAJE_CANTIDAD_NO_NUMERO)
    expect(validarCantidadFaltante('1,5', 5)).toBe(MENSAJE_CANTIDAD_NO_NUMERO)
    expect(validarCantidadFaltante('0', 5)).toBe(MENSAJE_CANTIDAD_CERO)
    expect(validarCantidadFaltante('6', 5)).toBe(MENSAJE_CANTIDAD_EXCEDE)
    expect(validarCantidadFaltante('5', 5)).toBeNull()
    expect(validarCantidadFaltante(' 2 ', 5)).toBeNull()
  })
})

describe('ventasFaltantes · mensajes de error', () => {
  it('traduce el conflicto de edición, el permiso y el estado', () => {
    expect(mensajeDeErrorFaltantes({ code: '40001' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_CONFLICTO)
    expect(mensajeDeErrorFaltantes({ code: '42501' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_SIN_PERMISO)
    expect(mensajeDeErrorFaltantes({ code: '55000' }, MENSAJE_ERROR_REGISTRAR)).toBe(MENSAJE_FUERA_DE_ESTADO)
  })

  it('muestra el mensaje de la RPC cuando es de la lista', () => {
    const mensaje = 'La cantidad faltante de la línea 1 tiene que estar entre 1 y 5'
    expect(mensajeDeErrorFaltantes({ code: '22023', message: mensaje }, MENSAJE_ERROR_REGISTRAR)).toBe(mensaje)
  })

  it('un error desconocido cae en el mensaje por defecto', () => {
    expect(mensajeDeErrorFaltantes({ code: 'XX000', message: 'detalle interno' }, MENSAJE_ERROR_LISTADO)).toBe(
      MENSAJE_ERROR_LISTADO,
    )
  })
})

describe('ventasFaltantes · aviso en el listado (F-VTA-26, FR-008; F-VTA-27, FR-103)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
  })

  it('pasa el filtro de aviso a la RPC y lee aviso y aviso_en de cada fila', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...fila(), filas: 1, aviso: 'para_avisar', aviso_en: '2026-10-08T12:00:00Z' }],
      error: null,
    })
    const pagina = await listarFaltantes({ empresaId: null, pagina: 1, tamano: 10, aviso: 'para_avisar' })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_faltantes', {
      p_empresa_id: null,
      p_pagina: 1,
      p_tamano: 10,
      p_aviso: 'para_avisar',
    })
    expect(pagina.faltantes[0].aviso).toBe('para_avisar')
    expect(pagina.faltantes[0].aviso_en).toBe('2026-10-08T12:00:00Z')
  })

  it('rotula el chip de la columna Aviso con la fecha en hora de Buenos Aires', () => {
    expect(etiquetaAviso({ aviso: 'sin_avisar', aviso_en: null })).toEqual({ texto: 'Sin avisar', variante: 'neutral' })
    expect(etiquetaAviso({ aviso: 'para_avisar', aviso_en: '2026-10-08T12:00:00Z' })).toEqual({
      texto: 'Para avisar',
      variante: 'info',
    })
    expect(etiquetaAviso({ aviso: 'avisado', aviso_en: '2026-10-08T12:00:00Z' })).toEqual({
      texto: 'Avisado · 08/10/2026',
      variante: 'exito',
    })
    // 01:00 UTC es todavía el día anterior en Buenos Aires.
    expect(etiquetaAviso({ aviso: 'avisado', aviso_en: '2026-10-09T01:00:00Z' }).texto).toBe('Avisado · 08/10/2026')
    expect(etiquetaAviso({ aviso: 'avisado', aviso_en: null }).texto).toBe('Avisado')
  })
})

const resultado = (cambios: Partial<ResultadoAvisoVenta> = {}): ResultadoAvisoVenta => ({
  encolados: 2,
  lineas_avisadas: 2,
  omitidos_ya_avisados: 0,
  omitidos_en_cola: 0,
  omitidos_sin_correo: 0,
  omitidos_sin_permiso: 0,
  omitidos_no_abiertos: 0,
  detalle: [],
  ...cambios,
})

describe('ventasFaltantes · avisar a los clientes (F-VTA-26, FR-001…FR-005)', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('llama a la RPC con los ids, el texto y la confirmación de reaviso', async () => {
    mocks.rpc.mockResolvedValue({ data: resultado(), error: null })
    await avisarFaltantesVenta(['f-1', 'f-2'], '  Ya llegó tu pedido  ', true)
    expect(mocks.rpc).toHaveBeenCalledWith('avisar_faltantes_venta', {
      p_ids: ['f-1', 'f-2'],
      p_mensaje: 'Ya llegó tu pedido',
      p_reavisar: true,
    })
  })

  it('el texto vacío o igual al de por defecto viaja como null', async () => {
    mocks.rpc.mockResolvedValue({ data: resultado(), error: null })
    await avisarFaltantesVenta(['f-1'], '   ', false)
    await avisarFaltantesVenta(['f-1'], TEXTO_AVISO_POR_DEFECTO, false)
    expect(mocks.rpc.mock.calls[0][1].p_mensaje).toBeNull()
    expect(mocks.rpc.mock.calls[1][1].p_mensaje).toBeNull()
  })

  it('valida de 1 a 200 faltantes y un texto de hasta 1.000 caracteres sin llamar a la base', async () => {
    await expect(avisarFaltantesVenta([], 'x', false)).rejects.toThrow('Elegí entre 1 y 200 faltantes para avisar.')
    const muchos = Array.from({ length: 201 }, (_, i) => `f-${i}`)
    await expect(avisarFaltantesVenta(muchos, 'x', false)).rejects.toThrow('Elegí entre 1 y 200 faltantes para avisar.')
    await expect(avisarFaltantesVenta(['f-1'], 'x'.repeat(1001), false)).rejects.toThrow(/1\.000 caracteres/)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('los errores llegan en castellano y sin detalle técnico', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied for table x' } })
    await expect(avisarFaltantesVenta(['f-1'], '', false)).rejects.toThrow('Tu rol no puede avisar faltantes')
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'detalle interno' } })
    await expect(avisarFaltantesVenta(['f-1'], '', false)).rejects.toThrow('No pudimos enviar los avisos. Probá de nuevo.')
    mocks.rpc.mockResolvedValueOnce({ data: { otra: 'cosa' }, error: null })
    await expect(avisarFaltantesVenta(['f-1'], '', false)).rejects.toThrow('No pudimos enviar los avisos. Probá de nuevo.')
  })

  it('arma el aviso emergente con lo omitido y por qué', () => {
    expect(mensajeResultadoAvisoVenta(resultado())).toBe('Avisos enviados.')
    expect(mensajeResultadoAvisoVenta(resultado({ omitidos_ya_avisados: 1, omitidos_en_cola: 2 }))).toBe(
      'Avisos enviados. 1 faltante ya estaba avisado. 2 faltantes tienen un envío en curso.',
    )
    expect(mensajeResultadoAvisoVenta(resultado({ omitidos_sin_permiso: 1, omitidos_no_abiertos: 3 }))).toBe(
      'Avisos enviados. 1 faltante es de una tienda donde tu rol no puede avisar. 3 faltantes ya no están abiertos.',
    )
  })

  it('sin correo dice qué cliente y, si no se encoló nada, que no se envió ningún aviso', () => {
    const uno = resultado({
      encolados: 0,
      lineas_avisadas: 0,
      omitidos_sin_correo: 1,
      detalle: [{ id: 'f-1', resultado: 'sin_correo' }],
    })
    expect(mensajeResultadoAvisoVenta(uno)).toBe('No se enviaron avisos. El cliente no tiene correo.')
    // Dos faltantes del mismo cliente cuentan como un cliente; dos clientes distintos, como dos.
    const mismo = resultado({
      omitidos_sin_correo: 2,
      detalle: [{ id: 'f-1', resultado: 'sin_correo' }, { id: 'f-2', resultado: 'sin_correo' }],
    })
    expect(mensajeResultadoAvisoVenta(mismo, { 'f-1': 'Ana', 'f-2': 'Ana' })).toBe(
      'Avisos enviados. El cliente no tiene correo.',
    )
    expect(mensajeResultadoAvisoVenta(mismo, { 'f-1': 'Ana', 'f-2': 'Beto' })).toBe(
      'Avisos enviados. 2 clientes no tienen correo.',
    )
  })
})
