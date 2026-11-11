import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-16 (MSF-166, FR-023): rótulos del bloque de envío por tipo de forma de envío, transportes elegibles
// (Decisión abierta 8 de la spec), validación de la guía y envoltorios de la RPC `guardar_envio_comprobante`.

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  schema: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  listarFormasEnvio: vi.fn(),
  listarTransportes: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, schema: mocks.schema },
}))

vi.mock('./ventas/formasEnvio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ventas/formasEnvio')>()),
  listarFormasEnvio: mocks.listarFormasEnvio,
}))

vi.mock('./ventas/transportes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ventas/transportes')>()),
  listarTransportes: mocks.listarTransportes,
}))

import {
  LARGO_MAXIMO_GUIA,
  MENSAJE_CONFLICTO_ENVIO,
  MENSAJE_ERROR_ENVIO,
  TEXTO_RETIRO_EN_LOCAL,
  esRetiroEnLocal,
  guardarEnvioComprobante,
  listarTransportesDeEmpresa,
  mensajeDeErrorEnvio,
  obtenerEnvioComprobante,
  obtenerFormaEnvioDeComprobante,
  obtenerTransportePorId,
  rotuloTransporte,
  transportesElegibles,
  validarGuia,
  type Transporte,
} from './ventasEnvio'

const transporte = (id: string, nombre: string, tipo: Transporte['tipo'], activa = true): Transporte => ({
  id,
  organizacion_id: 'o-1',
  nombre,
  tipo,
  cuit: null,
  terminal_retiro: null,
  localidad: null,
  telefono: null,
  correo: null,
  persona_contacto: null,
  direccion: null,
  cobra_contrarreembolso: false,
  comision_pct: 0,
  plazo_rendicion_dias: 0,
  orden: 1,
  activa,
  updated_at: '2026-12-14T10:00:00Z',
  empresas: [],
})

const CATALOGO: Transporte[] = [
  transporte('t-expreso', 'Expreso Ejemplo', 'expreso'),
  transporte('t-correo', 'Correo Ejemplo', 'correo'),
  transporte('t-moto', 'Moto 2', 'moto_propia'),
  transporte('t-apagado', 'Expreso Apagado', 'expreso', false),
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.schema.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ select: mocks.select })
  mocks.select.mockReturnValue({ eq: mocks.eq })
  mocks.eq.mockReturnValue({ eq: mocks.eq, maybeSingle: mocks.maybeSingle })
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.listarFormasEnvio.mockResolvedValue([])
  mocks.listarTransportes.mockResolvedValue({ transportes: [], total: 0, totalOrganizacion: 0 })
})

describe('Rótulos por tipo de forma de envío (FR-023)', () => {
  it('muestra «Transporte / expreso», «Correo» y «Mensajería propia» según la forma de envío', () => {
    expect(rotuloTransporte('expreso')).toBe('Transporte / expreso')
    expect(rotuloTransporte('terminal')).toBe('Transporte / expreso')
    expect(rotuloTransporte('correo')).toBe('Correo')
    expect(rotuloTransporte('moto')).toBe('Mensajería propia')
  })

  it('«Retiro en local» no lleva transporte: sin rótulo y con el texto de que el cliente retira', () => {
    expect(rotuloTransporte('retiro_local')).toBeNull()
    expect(esRetiroEnLocal('retiro_local')).toBe(true)
    expect(TEXTO_RETIRO_EN_LOCAL).toBe('El cliente retira en el local. No hace falta transporte ni guía.')
  })
})

describe('Transportes elegibles por tipo de envío (Decisión abierta 8)', () => {
  it('correo → transportes de correo; expreso → de expreso; moto → de mensajería propia', () => {
    expect(transportesElegibles('correo', CATALOGO).map((t) => t.id)).toEqual(['t-correo'])
    expect(transportesElegibles('expreso', CATALOGO).map((t) => t.id)).toEqual(['t-expreso'])
    expect(transportesElegibles('moto', CATALOGO).map((t) => t.id)).toEqual(['t-moto'])
  })

  it('terminal admite cualquiera de la empresa', () => {
    expect(transportesElegibles('terminal', CATALOGO).map((t) => t.id)).toEqual(['t-expreso', 't-correo', 't-moto'])
  })

  it('un transporte inactivo no se puede elegir', () => {
    expect(transportesElegibles('expreso', CATALOGO).map((t) => t.id)).not.toContain('t-apagado')
  })

  it('«Retiro en local» no admite ningún transporte', () => {
    expect(transportesElegibles('retiro_local', CATALOGO)).toEqual([])
  })

  it('lista los transportes de la empresa y filtra los que no se pueden elegir', async () => {
    mocks.listarTransportes.mockResolvedValue({ transportes: CATALOGO, total: 4, totalOrganizacion: 4 })
    const lista = await listarTransportesDeEmpresa('e-1')
    expect(mocks.listarTransportes).toHaveBeenCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 200 })
    expect(lista).toHaveLength(4)
  })
})

describe('Forma de envío del comprobante', () => {
  it('devuelve el tipo y si exige transporte y guía de la forma elegida', async () => {
    mocks.listarFormasEnvio.mockResolvedValue([
      {
        id: 'f-1',
        empresa_id: 'e-1',
        nombre: 'Expreso',
        tipo: 'expreso',
        exige_transporte_guia: true,
        costo_defecto: null,
        estado_despacho_inicial: 'sin_armar',
        orden: 1,
        activo: true,
        updated_at: '2026-12-14T10:00:00Z',
      },
    ])
    const forma = await obtenerFormaEnvioDeComprobante('e-1', 'f-1')
    expect(forma).toEqual({ id: 'f-1', nombre: 'Expreso', tipo: 'expreso', exige_transporte_guia: true })
  })

  it('sin forma de envío no hay bloque de transporte', async () => {
    expect(await obtenerFormaEnvioDeComprobante('e-1', null)).toBeNull()
    expect(mocks.listarFormasEnvio).not.toHaveBeenCalled()
  })
})

describe('Envío guardado', () => {
  it('lee el transporte, la guía y la fecha ya cargados', async () => {
    mocks.rpc.mockResolvedValue({
      data: { transporte_id: 't-1', guia: 'A-004471', fecha_envio: '2026-10-08', updated_at: '2026-12-14T10:00:00.123456+00:00' },
      error: null,
    })
    const datos = await obtenerEnvioComprobante('k-1')
    // La lectura va por la RPC: la RLS de `dominio.comprobantes_venta` resuelve el nivel de Ventas contra la
    // empresa ACTIVA, así que leer la tabla dejaría ver el envío de un comprobante de otra tienda de la misma
    // organización (BOLA entre tiendas). El permiso lo resuelve la base, en la empresa del comprobante.
    expect(mocks.rpc).toHaveBeenCalledWith('obtener_envio_comprobante', { p_id: 'k-1' })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(datos).toEqual({
      transporte_id: 't-1',
      guia: 'A-004471',
      fecha_envio: '2026-10-08',
      updated_at: '2026-12-14T10:00:00.123456+00:00',
    })
  })

  it('sin envío cargado devuelve los campos vacíos', async () => {
    mocks.rpc.mockResolvedValue({
      data: { transporte_id: null, guia: null, fecha_envio: null, updated_at: '2026-12-14T10:00:00+00:00' },
      error: null,
    })
    const datos = await obtenerEnvioComprobante('k-2')
    expect(datos).toEqual({
      transporte_id: null,
      guia: null,
      fecha_envio: null,
      updated_at: '2026-12-14T10:00:00+00:00',
    })
  })

  it('si la base no deja leer el envío, el error sube tal cual (no se muestra un envío vacío)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'Tu rol no puede ver los comprobantes de esta tienda' },
    })
    await expect(obtenerEnvioComprobante('k-3')).rejects.toMatchObject({ code: '42501' })
  })

  it('manda la guía, la fecha y el bloqueo optimista a la RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: { transporte_id: 't-1', guia: 'A-1', fecha_envio: '2026-10-08', updated_at: '2026-12-14T11:00:00+00:00' },
      error: null,
    })
    const guardado = await guardarEnvioComprobante({
      id: 'k-1',
      transporteId: 't-1',
      guia: 'A-1',
      fechaEnvio: '2026-10-08',
      actualizadoEn: '2026-12-14T10:00:00.123456+00:00',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_envio_comprobante', {
      p_id: 'k-1',
      p_transporte_id: 't-1',
      p_guia: 'A-1',
      p_fecha_envio: '2026-10-08',
      p_actualizado_en: '2026-12-14T10:00:00.123456+00:00',
    })
    expect(guardado.transporte_id).toBe('t-1')
  })
})

describe('Transporte cargado fuera del catálogo de la tienda', () => {
  it('lee el transporte por id cuando el catálogo de la tienda no lo trae', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 't-1', nombre: 'Expreso Retirado', activa: true },
      error: null,
    })
    const transporte = await obtenerTransportePorId('t-1')
    expect(mocks.schema).toHaveBeenCalledWith('dominio')
    expect(mocks.from).toHaveBeenCalledWith('transportes')
    expect(mocks.eq).toHaveBeenCalledWith('id', 't-1')
    expect(transporte).toEqual({ id: 't-1', nombre: 'Expreso Retirado', activa: true })
  })

  it('si el transporte no existe, no hay nada que mostrar', async () => {
    expect(await obtenerTransportePorId('t-1')).toBeNull()
  })
})

describe('Validación de la guía', () => {
  it('acepta hasta 100 caracteres y avisa más allá', () => {
    expect(validarGuia('A-004471')).toBeNull()
    expect(validarGuia('x'.repeat(LARGO_MAXIMO_GUIA))).toBeNull()
    expect(validarGuia('x'.repeat(LARGO_MAXIMO_GUIA + 1))).toBe(
      `La guía no puede tener más de ${LARGO_MAXIMO_GUIA} caracteres.`,
    )
  })
})

describe('Mensajes de error', () => {
  it('el conflicto de concurrencia avisa que hay que recargar', () => {
    expect(mensajeDeErrorEnvio({ code: '40001' })).toBe(MENSAJE_CONFLICTO_ENVIO)
  })

  it('muestra el mensaje en castellano de la RPC cuando es de los conocidos', () => {
    expect(mensajeDeErrorEnvio({ code: '22023', message: 'El transporte «X» está desactivado: elegí otro' })).toBe(
      'El transporte «X» está desactivado: elegí otro',
    )
  })

  it('con un error desconocido no inventa: avisa que no se guardó nada', () => {
    expect(mensajeDeErrorEnvio({ code: 'XX000' })).toBe(MENSAJE_ERROR_ENVIO)
    expect(mensajeDeErrorEnvio(null)).toBe(MENSAJE_ERROR_ENVIO)
  })
})
