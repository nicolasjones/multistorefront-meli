import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  ESTADOS_DESPACHO, MENSAJE_CONFLICTO_DESPACHO, MENSAJE_ERROR_DESPACHO, SIN_RESPONSABLE, ayudaEstadoDespacho, cambiarEstadoDespacho, etiquetaEstadoDespacho,
  idResponsable, listarResponsablesDespacho, mensajeDeErrorDespacho, nombreResponsable, obtenerDespachoComprobante, proximoPaso, type DatosDespacho,
} from './ventasDespacho'

const datos: DatosDespacho = {
  estado_despacho: 'armando', armo_id: 'u1', armo: 'Ana', controlo_id: null, controlo: null, entrego_id: 'u3', entrego: 'Luis', entregado_en: null,
  updated_at: 'v1', puede_despachar: true,
}

describe('proximoPaso', () => {
  it('recorre sin_armar → armando → listo → entregado y entregado es terminal', () => {
    expect(proximoPaso('sin_armar')?.estado).toBe('armando')
    expect(proximoPaso('armando')).toMatchObject({ estado: 'listo_para_despachar', funcion: 'controlar', responsable: 'controlo' })
    expect(proximoPaso('listo_para_despachar')).toMatchObject({ estado: 'entregado', funcion: 'entregar' })
    expect(proximoPaso('entregado')).toBeNull()
  })

  it('un despacho incompleto se reanuda armando; sin estado no hay paso', () => {
    expect(proximoPaso('incompleto')).toMatchObject({ estado: 'armando', etiqueta: 'Reanudar el armado' })
    expect(proximoPaso(null)).toBeNull()
    expect(proximoPaso(undefined)).toBeNull()
  })

  it('todo estado tiene etiqueta y ayuda', () => {
    for (const estado of ESTADOS_DESPACHO) {
      expect(etiquetaEstadoDespacho(estado)).not.toBe(estado)
      expect(ayudaEstadoDespacho(estado)).not.toBe('')
    }
  })
})

describe('etiquetas y responsables', () => {
  it('etiquetaEstadoDespacho y ayudaEstadoDespacho cubren nulo y desconocido', () => {
    expect(etiquetaEstadoDespacho(null)).toBe('Sin estado')
    expect(etiquetaEstadoDespacho('raro')).toBe('raro')
    expect(ayudaEstadoDespacho(null)).toMatch(/todavía no entró/)
    expect(ayudaEstadoDespacho('raro')).toBe('')
  })

  it('nombreResponsable e idResponsable leen el campo del paso o caen al valor vacío', () => {
    expect(nombreResponsable(datos, 'armo')).toBe('Ana')
    expect(nombreResponsable(datos, 'controlo')).toBe(SIN_RESPONSABLE)
    expect(nombreResponsable(datos, 'entrego')).toBe('Luis')
    expect(nombreResponsable(null, 'armo')).toBe(SIN_RESPONSABLE)
    expect(idResponsable(datos, 'entrego')).toBe('u3')
    expect(idResponsable(datos, 'controlo')).toBeNull()
    expect(idResponsable(null, 'armo')).toBeNull()
  })
})

describe('mensajeDeErrorDespacho', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('conflicto, mensajes de la RPC, inexistente y genérico', () => {
    expect(mensajeDeErrorDespacho({ code: '40001' })).toBe(MENSAJE_CONFLICTO_DESPACHO)
    expect(mensajeDeErrorDespacho({ code: 'PT412' })).toBe(MENSAJE_CONFLICTO_DESPACHO)
    expect(mensajeDeErrorDespacho({ code: 'PT404' })).toMatch(/no existe/)
    expect(mensajeDeErrorDespacho({ code: '22023', message: 'Elegí quién arma el pedido.' })).toBe('Elegí quién arma el pedido.')
    expect(mensajeDeErrorDespacho({ code: '42501', message: 'permission denied for table x' })).toBe(MENSAJE_ERROR_DESPACHO)
    expect(mensajeDeErrorDespacho({ code: 'P0002' })).toMatch(/no existe/)
    expect(mensajeDeErrorDespacho(null)).toBe(MENSAJE_ERROR_DESPACHO)
  })
})

describe('llamadas a la base', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('obtenerDespachoComprobante completa los faltantes con nulos', async () => {
    mocks.rpc.mockResolvedValue({ data: { estado_despacho: 'sin_armar', puede_despachar: true }, error: null })
    await expect(obtenerDespachoComprobante('c1')).resolves.toMatchObject({ estado_despacho: 'sin_armar', armo: null, updated_at: '', puede_despachar: true })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(obtenerDespachoComprobante('c1')).resolves.toMatchObject({ estado_despacho: null, puede_despachar: false })
  })

  it('listarResponsablesDespacho devuelve lista vacía si la respuesta no es un arreglo', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ user_id: 'u', nombre: 'N', rol_id: 'operador' }], error: null })
    await expect(listarResponsablesDespacho('e1', 'armar')).resolves.toHaveLength(1)
    expect(mocks.rpc).toHaveBeenCalledWith('listar_responsables_despacho', { p_empresa_id: 'e1', p_funcion: 'armar' })
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(listarResponsablesDespacho('e1', 'armar')).resolves.toEqual([])
  })

  it('cambiarEstadoDespacho manda el sello optimista y propaga el error', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await cambiarEstadoDespacho({ id: 'c1', estado: 'armando', responsableId: 'u1', actualizadoEn: 'v1' })
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_despacho', { p_id: 'c1', p_estado: 'armando', p_responsable_id: 'u1', p_actualizado_en: 'v1' })
    mocks.rpc.mockResolvedValue({ error: { code: '40001' } })
    await expect(cambiarEstadoDespacho({ id: 'c1', estado: 'armando', responsableId: 'u1', actualizadoEn: 'v0' })).rejects.toMatchObject({ code: '40001' })
    mocks.rpc.mockResolvedValue({ error: { code: 'PT412' } })
    await expect(cambiarEstadoDespacho({ id: 'c1', estado: 'armando', responsableId: 'u1', actualizadoEn: 'v0' })).rejects.toMatchObject({ code: 'PT412' })
  })
})
