import { describe, expect, it, vi } from 'vitest'
import {
  AVISO_COTIZACION_REGISTRADA,
  MENSAJE_COTIZACION_VENCIDA,
  MENSAJE_VARIACION_SIN_CONFIRMAR,
  MENSAJE_DOLAR_CAMBIO,
  requiereRevisarDeNuevo,
  MENSAJE_VALOR_INVALIDO,
  avisoCotizacionAplicada,
  cargarCotizacionRpc,
  confirmarCotizacionRpc,
  esCotizacionSugerida,
  textoDeCotizacionSugerida,
  descartarCotizacionRpc,
  formatearPrecioPrevio,
  mensajeDeErrorConfirmacion,
  previsualizarCotizacionRpc,
  textoPrecios,
  esVariacionInusual,
  formatearCotizacion,
  formatearVariacion,
  leerCotizacionDelDia,
  leerEstadoCotizacion,
  mensajeDeErrorCotizacion,
  parsearCotizacion,
  subtituloCargadaHoy,
  subtituloVigente,
  textoAnterior,
  variacionPorcentual,
} from './cotizacion'

const clienteCon = (resultado: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(resultado)
  return { rpc, cliente: { rpc } as never }
}

describe('parsearCotizacion', () => {
  it('acepta 1490 y 1490,50 (y el punto de miles)', () => {
    expect(parsearCotizacion('1490')).toBe(1490)
    expect(parsearCotizacion('1490,50')).toBe(1490.5)
    expect(parsearCotizacion('1.490')).toBe(1490)
    expect(parsearCotizacion('1.490,5')).toBe(1490.5)
  })

  it('rechaza vacío, cero, no numérico y formatos ambiguos', () => {
    for (const texto of ['', '  ', '0', '0,00', 'abc', '1490.50', '1,2,3', ',5', '12345,12345', '-5']) {
      expect(parsearCotizacion(texto), texto).toBeNull()
    }
  })

  it('rechaza lo que la base no soporta (≥ 10.000.000.000)', () => {
    expect(parsearCotizacion('10000000000')).toBeNull()
    expect(parsearCotizacion('9999999999')).toBe(9999999999)
  })
})

describe('variación', () => {
  it('se calcula contra el anterior y es nula sin anterior', () => {
    expect(variacionPorcentual(1490, 1465)).toBeCloseTo(1.7065, 3)
    expect(variacionPorcentual(1000, null)).toBeNull()
    expect(variacionPorcentual(1000, 0)).toBeNull()
  })

  it('se formatea con signo y coma decimal', () => {
    expect(formatearVariacion(1.7065)).toBe('+1,7 %')
    expect(formatearVariacion(-0.34)).toBe('−0,3 %')
    expect(formatearVariacion(0)).toBe('+0,0 %')
    expect(formatearVariacion(-0.01)).toBe('+0,0 %')
    expect(formatearVariacion(null)).toBe('—')
  })

  it('es inusual solo por encima del 15 % (en cualquier sentido)', () => {
    expect(esVariacionInusual(15)).toBe(false)
    expect(esVariacionInusual(15.1)).toBe(true)
    expect(esVariacionInusual(-20)).toBe(true)
    expect(esVariacionInusual(null)).toBe(false)
  })
})

describe('textos de la tarjeta y el diálogo', () => {
  const vigente = { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: 'Javier' }

  it('formatea pesos como en el prototipo', () => {
    expect(formatearCotizacion(1465)).toBe('$ 1.465')
  })

  it('arma «Última carga» con fecha y quién', () => {
    expect(subtituloVigente(vigente)).toBe('Última carga: vie 25/09 por Javier')
    expect(subtituloVigente({ ...vigente, cargadaPor: null })).toBe('Última carga: vie 25/09')
  })

  it('arma «Anterior»', () => {
    expect(textoAnterior(vigente)).toBe('Anterior: $ 1.465 (vie 25/09)')
  })
})

describe('mensajeDeErrorCotizacion', () => {
  it('traduce los códigos de la base a mensajes claros', () => {
    expect(mensajeDeErrorCotizacion({ code: '42501' })).toBe('Tu rol no puede cargar la cotización del dólar.')
    expect(mensajeDeErrorCotizacion({ code: '23514' })).toBe(MENSAJE_VALOR_INVALIDO)
    expect(mensajeDeErrorCotizacion({ code: '22003' })).toBe(MENSAJE_VALOR_INVALIDO)
    expect(mensajeDeErrorCotizacion({ code: 'XX000' })).toBe('No pudimos cargar la cotización. Intentá de nuevo.')
    expect(mensajeDeErrorCotizacion(null)).toBe('No pudimos cargar la cotización. Intentá de nuevo.')
  })
})

describe('llamadas a la base', () => {
  it('estado_cotizacion mapea vigente, productos en USD y pendiente', async () => {
    const { cliente, rpc } = clienteCon({
      data: {
        vigente: { valor: '1465.0000', cargada_en: '2026-09-25T12:00:00Z', cargada_por: null },
        productos_usd: 38,
        pendiente: { valor: 1490, expira_en: '2026-09-26T12:00:00Z' },
      },
      error: null,
    })
    await expect(leerEstadoCotizacion(cliente)).resolves.toEqual({
      vigente: { valor: 1465, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: null },
      aplicada: null,
      productosUsd: 38,
      pendiente: { valor: 1490, expiraEn: '2026-09-26T12:00:00Z' },
      alcance: 'sistema', umbralPct: 1, confirmacionPct: 15, redondeoPesos: 10,
    })
    expect(rpc).toHaveBeenCalledWith('estado_cotizacion')
  })

  it('estado_cotizacion sin vigente ni pendiente', async () => {
    const { cliente } = clienteCon({ data: { vigente: null, productos_usd: 0, pendiente: null }, error: null })
    await expect(leerEstadoCotizacion(cliente)).resolves.toEqual({ vigente: null, aplicada: null, productosUsd: 0, pendiente: null, alcance: 'sistema', umbralPct: 1, confirmacionPct: 15, redondeoPesos: 10 })
  })

  it('un error de la base no se traga', async () => {
    const error = { code: '42501', message: 'sin permiso' }
    await expect(leerEstadoCotizacion(clienteCon({ data: null, error }).cliente)).rejects.toBe(error)
    await expect(cargarCotizacionRpc(clienteCon({ data: null, error }).cliente, 1490)).rejects.toBe(error)
  })

  it('cargar_cotizacion envía p_valor y mapea la respuesta', async () => {
    const { cliente, rpc } = clienteCon({
      data: { valor: 1490, anterior: 1465, variacion_pct: 1.7065, expira_en: '2026-09-26T12:00:00Z' },
      error: null,
    })
    await expect(cargarCotizacionRpc(cliente, 1490)).resolves.toEqual({
      valor: 1490, anterior: 1465, variacionPct: 1.7065, expiraEn: '2026-09-26T12:00:00Z',
    })
    expect(rpc).toHaveBeenCalledWith('cargar_cotizacion', { p_valor: 1490 })
  })

  it('cargar_cotizacion sin anterior devuelve nulos', async () => {
    const { cliente } = clienteCon({ data: { valor: 1000, anterior: null, variacion_pct: null, expira_en: 'x' }, error: null })
    await expect(cargarCotizacionRpc(cliente, 1000)).resolves.toMatchObject({ anterior: null, variacionPct: null })
  })
})

describe('cotización del día (F-PRE-05)', () => {
  it('subtituloCargadaHoy: hora de Buenos Aires y quién', () => {
    const dia = { cargadaHoy: true, cargadaEn: '2026-10-23T13:32:00Z', cargadaPor: 'Administrador', valor: 1490, avisoActivo: true }
    expect(subtituloCargadaHoy(dia)).toBe('Cargada hoy 10:32 por Administrador')
    expect(subtituloCargadaHoy({ ...dia, cargadaPor: null })).toBe('Cargada hoy 10:32')
    expect(subtituloCargadaHoy({ ...dia, cargadaEn: null })).toBe('Cargada hoy por Administrador')
  })

  it('subtituloCargadaHoy: medianoche en Buenos Aires es 00:00', () => {
    const dia = { cargadaHoy: true, cargadaEn: '2026-10-23T03:00:00Z', cargadaPor: null, valor: 1490, avisoActivo: true }
    expect(subtituloCargadaHoy(dia)).toBe('Cargada hoy 00:00')
  })

  it('leerCotizacionDelDia llama a cotizacion_del_dia y mapea la respuesta', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { cargada_hoy: false, cargada_en: null, cargada_por: null, valor: null }, error: null })
    const dia = await leerCotizacionDelDia({ rpc } as never)
    expect(rpc).toHaveBeenCalledWith('cotizacion_del_dia')
    expect(dia).toEqual({ cargadaHoy: false, cargadaEn: null, cargadaPor: null, valor: null, avisoActivo: true })
  })

  it('leerCotizacionDelDia propaga el error de la base', async () => {
    const error = { code: '42501' }
    await expect(leerCotizacionDelDia({ rpc: vi.fn().mockResolvedValue({ data: null, error }) } as never)).rejects.toBe(error)
  })
})

describe('F-PRE-03 · vista previa, confirmación y descarte', () => {
  it('previsualizarCotizacionRpc traduce el contrato de la base', async () => {
    const { cliente, rpc } = clienteCon({
      data: {
        variacion_pct: '5.0000',
        recalcula: true,
        empresas: [{ empresa_id: 'e1', nombre: 'Mundo JC', precios: '2' }],
        muestra: [{ producto: 'Case', sku: 'CAS-1', usd: '10.00', por_empresa: [{ empresa_id: 'e1', hoy: '10000.00', nuevo: null }] }],
      },
      error: null,
    })
    await expect(previsualizarCotizacionRpc(cliente)).resolves.toEqual({
      variacionPct: 5,
      recalcula: true,
      umbralPct: 1,
      redondeoPesos: 10,
      empresas: [{ empresaId: 'e1', nombre: 'Mundo JC', precios: 2 }],
      muestra: [{ producto: 'Case', sku: 'CAS-1', usd: 10, porEmpresa: [{ empresaId: 'e1', hoy: 10000, nuevo: null, usd: null }] }],
    })
    expect(rpc).toHaveBeenCalledWith('previsualizar_cotizacion')
  })

  it('previsualizarCotizacionRpc: trae la variación inusual configurada en la base', async () => {
    const { cliente } = clienteCon({ data: { variacion_pct: '12', recalcula: true, confirmacion_pct: '10.000', empresas: [], muestra: [] }, error: null })
    await expect(previsualizarCotizacionRpc(cliente)).resolves.toMatchObject({ confirmacionPct: 10 })
  })

  it('sin cotización previa la variación llega nula (no se inventa)', async () => {
    const { cliente } = clienteCon({ data: { variacion_pct: null, recalcula: true, empresas: [], muestra: [] }, error: null })
    await expect(previsualizarCotizacionRpc(cliente)).resolves.toMatchObject({ variacionPct: null })
  })

  it('confirmarCotizacionRpc devuelve lo que decidió la base', async () => {
    const { cliente, rpc } = clienteCon({ data: { id: 'c1', recalculo_aplicado: false, precios_recalculados: '0' }, error: null })
    await expect(confirmarCotizacionRpc(cliente)).resolves.toEqual({ id: 'c1', recalculoAplicado: false, preciosRecalculados: 0 })
    expect(rpc).toHaveBeenCalledWith('confirmar_cotizacion')
  })

  it('confirmarCotizacionRpc manda la variación vista solo cuando hay aviso de variación inusual', async () => {
    const { cliente, rpc } = clienteCon({ data: { id: 'c1', recalculo_aplicado: true, precios_recalculados: '4' }, error: null })
    await confirmarCotizacionRpc(cliente, 'e1', 37.8353)
    expect(rpc).toHaveBeenCalledWith('confirmar_cotizacion', { p_empresa: 'e1', p_variacion_vista: 37.8353 })
    await confirmarCotizacionRpc(cliente, 'e1')
    expect(rpc).toHaveBeenLastCalledWith('confirmar_cotizacion', { p_empresa: 'e1' })
    await confirmarCotizacionRpc(cliente, null, -20)
    expect(rpc).toHaveBeenLastCalledWith('confirmar_cotizacion', { p_variacion_vista: -20 })
  })

  it('mensajeDeErrorConfirmacion: la variación inusual se distingue por el hint; otro 22023 (falta empresa) es genérico', () => {
    expect(mensajeDeErrorConfirmacion({ code: '22023', hint: 'variacion_inusual' })).toBe(MENSAJE_VARIACION_SIN_CONFIRMAR)
    expect(mensajeDeErrorConfirmacion({ code: '22023', hint: 'variacion_cambio' })).toBe(MENSAJE_DOLAR_CAMBIO)
    expect(requiereRevisarDeNuevo({ code: '22023', hint: 'variacion_cambio' })).toBe(true)
    expect(requiereRevisarDeNuevo({ code: '22023', hint: 'variacion_inusual' })).toBe(true)
    expect(requiereRevisarDeNuevo({ code: '22023', hint: null })).toBe(false)
    expect(requiereRevisarDeNuevo({ code: 'P0002' })).toBe(false)
    expect(mensajeDeErrorConfirmacion({ code: '22023', hint: null })).toBe('No pudimos confirmar la cotización. Intentá de nuevo.')
    expect(mensajeDeErrorConfirmacion({ code: '22023' })).not.toBe(MENSAJE_VARIACION_SIN_CONFIRMAR)
  })

  it('textoAnterior: con una aplicada distinta de la última carga muestra la aplicada', () => {
    const vigente = { valor: 1040, cargadaEn: '2026-09-25T12:00:00Z', cargadaPor: null }
    expect(textoAnterior(vigente, 1000)).toBe('Anterior: $ 1.000 (la que usan los precios)')
    expect(textoAnterior(vigente, 1040)).toBe(textoAnterior(vigente))
    expect(textoAnterior(vigente, null)).toBe(textoAnterior(vigente))
  })

  it('previsualizarCotizacionRpc: un producto en pesos con precio propio en USD toma el USD de la empresa (no 0)', async () => {
    const { cliente } = clienteCon({
      data: {
        variacion_pct: '6.6667', recalcula: true, empresas: [{ empresa_id: 'e1', nombre: 'Mundo JC', precios: 1 }],
        muestra: [{ producto: 'Cable', sku: null, usd: null, por_empresa: [{ empresa_id: 'e1', usd: '4.00', hoy: '6000.00', nuevo: '6400.00' }] }],
      },
      error: null,
    })
    await expect(previsualizarCotizacionRpc(cliente)).resolves.toMatchObject({
      muestra: [{ producto: 'Cable', usd: 4, porEmpresa: [{ empresaId: 'e1', hoy: 6000, nuevo: 6400 }] }],
    })
  })

  it('leerEstadoCotizacion: informa la cotización aplicada; sin dato queda nula', async () => {
    const con = clienteCon({ data: { vigente: null, aplicada: '1000.0000', productos_usd: 0, pendiente: null }, error: null })
    await expect(leerEstadoCotizacion(con.cliente)).resolves.toMatchObject({ aplicada: 1000 })
    const sin = clienteCon({ data: { vigente: null, aplicada: null, productos_usd: 0, pendiente: null }, error: null })
    await expect(leerEstadoCotizacion(sin.cliente)).resolves.toMatchObject({ aplicada: null })
  })

  it('descartarCotizacionRpc llama a la base y propaga el error', async () => {
    const ok = clienteCon({ data: null, error: null })
    await expect(descartarCotizacionRpc(ok.cliente)).resolves.toBeUndefined()
    expect(ok.rpc).toHaveBeenCalledWith('descartar_cotizacion')
    const error = { code: '42501' }
    await expect(descartarCotizacionRpc(clienteCon({ data: null, error }).cliente)).rejects.toBe(error)
  })

  it.each([
    ['previsualizarCotizacionRpc', previsualizarCotizacionRpc],
    ['confirmarCotizacionRpc', confirmarCotizacionRpc],
  ])('%s propaga el error de la base (no lo traga)', async (_nombre, funcion) => {
    const error = { code: 'P0002' }
    await expect(funcion(clienteCon({ data: null, error }).cliente)).rejects.toBe(error)
  })

  it('mensajeDeErrorConfirmacion: vencida, sin permiso y genérico (nunca el texto técnico)', () => {
    expect(mensajeDeErrorConfirmacion({ code: 'P0002' })).toBe(MENSAJE_COTIZACION_VENCIDA)
    expect(MENSAJE_COTIZACION_VENCIDA).toBe('La cotización cargada venció; volvé a cargarla.')
    expect(mensajeDeErrorConfirmacion({ code: '42501' })).toBe('Tu rol no puede confirmar la cotización del dólar.')
    expect(mensajeDeErrorConfirmacion({ code: 'XX000' })).toBe('No pudimos confirmar la cotización. Intentá de nuevo.')
    expect(mensajeDeErrorConfirmacion(null)).toBe('No pudimos confirmar la cotización. Intentá de nuevo.')
  })

  it('textos de aviso y formato de precios', () => {
    expect(avisoCotizacionAplicada(89)).toBe('Cotización aplicada · 89 precios recalculados')
    expect(AVISO_COTIZACION_REGISTRADA).toBe('Cotización registrada · variación menor al umbral, precios sin cambios')
    expect(textoPrecios(1)).toBe('1 precio')
    expect(textoPrecios(38)).toBe('38 precios')
    expect(formatearPrecioPrevio(29190)).toBe('$ 29.190')
    expect(formatearPrecioPrevio(null)).toBe('—')
  })

  it('esCotizacionSugerida: acepta el contrato y rechaza lo demás', () => {
    expect(esCotizacionSugerida({ valor: 1405.5, fuente: 'DolarApi', fecha: null })).toBe(true)
    expect(esCotizacionSugerida({ valor: 1405.5, fuente: 'DolarApi', fecha: '2026-11-11T10:00:00.000Z' })).toBe(true)
    for (const dato of [null, undefined, 'texto', {}, { valor: '1405', fuente: 'x', fecha: null }, { valor: 0, fuente: 'x', fecha: null },
      { valor: -1, fuente: 'x', fecha: null }, { valor: Number.NaN, fuente: 'x', fecha: null }, { valor: 1e10, fuente: 'x', fecha: null },
      { valor: 1405, fuente: 3, fecha: null }, { valor: 1405, fuente: 'x', fecha: 5 }]) {
      expect(esCotizacionSugerida(dato)).toBe(false)
    }
  })

  it('textoDeCotizacionSugerida: coma decimal y sin separador de miles', () => {
    expect(textoDeCotizacionSugerida(1405.5)).toBe('1405,5')
    expect(textoDeCotizacionSugerida(1405)).toBe('1405')
    expect(textoDeCotizacionSugerida(1405.57)).toBe('1405,57')
  })
})
