import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  MENSAJE_ANULADA,
  MENSAJE_CONFLICTO_REPARACION,
  actualizarReparacion,
  aFormulario,
  anularReparacion,
  cambiarEstadoReparacion,
  errorDeCampoDe,
  formularioEntregaVacio,
  listarHistorial,
  registrarEntregaReparacion,
  validarEntrega,
  validarMotivoAnulacion,
  crearReparacion,
  errorDeCampo,
  esConflictoDeEdicion,
  formularioVacio,
  hoyEnArgentina,
  listarTecnicos,
  mensajeDeErrorReparacion,
  obtenerReparacion,
  textoUso,
  usoDeEstados,
  usoDeModelos,
  validarReparacion,
  type FormularioReparacion,
  type Reparacion,
} from './reparaciones'

const REPARACION: Reparacion = {
  id: 'r-1',
  numero: 1,
  codigo: 'R-0001',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  cliente_id: 'c-1',
  cliente: 'Ana Pérez',
  contacto: '11 5555-5555',
  modelo_id: 'm-1',
  equipo: 'Nintendo Switch',
  modelo: 'Lite',
  estado_id: 's-1',
  estado: 'Recibido',
  estado_cierra: false,
  estado_tono: 'neutral',
  numero_serie: 'SN-1',
  accesorios: 'Cargador',
  falla: 'No enciende',
  puede_ver_costos: true,
  costo_mano_obra: 120.5,
  costo_repuestos: null,
  tecnico_id: null,
  ingreso_en: '2026-10-20',
  entrega_prevista: null,
  entrega_real: null,
  entregado_por: null,
  anulada_en: null,
  anulada_motivo: null,
  updated_at: '2026-10-20T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

// PostgREST devuelve los RPC como `{ data, error }` y `.returns()` encadena el tipo.
function respuesta(data: unknown, error: unknown = null) {
  const resultado: Record<string, unknown> = { data, error }
  resultado.returns = () => resultado
  return resultado
}

const form = (extra: Partial<FormularioReparacion> = {}): FormularioReparacion => ({
  ...formularioVacio('e-1'),
  cliente: { id: 'c-1', nombre: 'Ana Pérez', contacto: '11 5555-5555' },
  equipo: 'Nintendo Switch',
  modelo_id: 'm-1',
  ...extra,
})

describe('hoyEnArgentina', () => {
  it('usa la fecha de Argentina, no la UTC', () => {
    expect(hoyEnArgentina(new Date('2026-10-20T02:00:00Z'))).toBe('2026-10-19')
    expect(hoyEnArgentina(new Date('2026-10-20T12:00:00Z'))).toBe('2026-10-20')
  })
})

describe('formularioVacio / aFormulario', () => {
  it('arranca con la tienda activa, la fecha de hoy y sin cliente', () => {
    const vacio = formularioVacio('e-1')
    expect(vacio.empresa_id).toBe('e-1')
    expect(vacio.cliente).toBeNull()
    expect(vacio.ingreso_en).toBe(hoyEnArgentina())
    expect(vacio.costo_mano_obra).toBe('')
  })

  it('precarga una reparación con importes en coma y los nulos vacíos', () => {
    const cargado = aFormulario(REPARACION)
    expect(cargado.cliente).toEqual({ id: 'c-1', nombre: 'Ana Pérez', contacto: '11 5555-5555' })
    expect(cargado.costo_mano_obra).toBe('120,5')
    expect(cargado.costo_repuestos).toBe('')
    expect(cargado.numero_serie).toBe('SN-1')
    expect(cargado.entrega_prevista).toBe('')
  })

  it('va y vuelve sin perder datos editables', () => {
    expect(aFormulario(REPARACION)).toEqual(form({
      contacto: '11 5555-5555',
      numero_serie: 'SN-1',
      accesorios: 'Cargador',
      falla: 'No enciende',
      costo_mano_obra: '120,5',
      ingreso_en: '2026-10-20',
    }))
  })
})

describe('validarReparacion', () => {
  it('exige cliente y modelo en el alta', () => {
    const errores = validarReparacion(formularioVacio(''), { esNueva: true, conCostos: false })
    expect(errores.empresa_id).toBe('Elegí la tienda.')
    expect(errores.cliente_id).toBe('Elegí el cliente.')
    expect(errores.modelo_id).toBe('Elegí el modelo.')
    expect(errores.equipo).toBe('Elegí la consola o el equipo.')
  })

  it('acepta un formulario completo y no exige empresa al editar', () => {
    expect(validarReparacion(form({ empresa_id: '' }), { esNueva: false, conCostos: true })).toEqual({})
  })

  it('limita el largo de los textos libres', () => {
    const errores = validarReparacion(form({
      contacto: 'a'.repeat(201),
      numero_serie: 'a'.repeat(101),
      accesorios: 'a'.repeat(501),
      falla: 'a'.repeat(1001),
    }), { esNueva: false, conCostos: false })
    expect(errores.contacto).toBe('Máximo 200 caracteres.')
    expect(errores.numero_serie).toBe('Máximo 100 caracteres.')
    expect(errores.accesorios).toBe('Máximo 500 caracteres.')
    expect(errores.falla).toBe('Máximo 1000 caracteres.')
  })

  it('valida fechas: ingreso obligatorio y entrega prevista no anterior', () => {
    expect(validarReparacion(form({ ingreso_en: '' }), { esNueva: false, conCostos: false }).ingreso_en)
      .toBe('Ingresá la fecha de ingreso.')
    expect(validarReparacion(form({ ingreso_en: '2999-01-01' }), { esNueva: false, conCostos: false }).ingreso_en)
      .toBe('El ingreso no puede ser una fecha futura.')
    expect(validarReparacion(form({ ingreso_en: '2026-10-20', entrega_prevista: '2026-10-19' }), { esNueva: false, conCostos: false }).entrega_prevista)
      .toBe('La entrega prevista no puede ser anterior al ingreso.')
    expect(validarReparacion(form({ ingreso_en: '2026-10-20', entrega_prevista: '2026-10-20' }), { esNueva: false, conCostos: false }))
      .toEqual({})
  })

  it('valida costos solo si el usuario los ve (conCostos)', () => {
    expect(validarReparacion(form({ costo_mano_obra: 'x' }), { esNueva: false, conCostos: false })).toEqual({})
    const errores = validarReparacion(form({ costo_mano_obra: 'x', costo_repuestos: '-1' }), { esNueva: false, conCostos: true })
    expect(errores.costo_mano_obra).toContain('importe de cero o más')
    expect(errores.costo_repuestos).toContain('importe de cero o más')
  })
})

describe('errores de la base', () => {
  it('mapea el hint de la RPC al campo cuando es un error de validación', () => {
    expect(errorDeCampo({ code: '22023', message: 'Elegí el modelo', hint: 'modelo_id' }))
      .toEqual({ campo: 'modelo_id', mensaje: 'Elegí el modelo' })
    expect(errorDeCampo({ code: '22023', message: 'x', hint: 'otro' })).toBeNull()
    expect(errorDeCampo({ code: '42501', message: 'x', hint: 'modelo_id' })).toBeNull()
    expect(errorDeCampo(null)).toBeNull()
  })

  it('reconoce el conflicto de edición', () => {
    expect(esConflictoDeEdicion({ code: '40001' })).toBe(true)
    expect(esConflictoDeEdicion({ code: '42501' })).toBe(false)
  })

  it('traduce los códigos a mensajes claros', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(mensajeDeErrorReparacion({ code: '42501' }, 'x')).toContain('No tenés permiso')
    expect(mensajeDeErrorReparacion({ code: '40001' }, 'x')).toBe(MENSAJE_CONFLICTO_REPARACION)
    expect(mensajeDeErrorReparacion({ code: '55000' }, 'x')).toBe(MENSAJE_ANULADA)
    expect(mensajeDeErrorReparacion({ code: 'P0002' }, 'x')).toContain('ya no existe')
    expect(mensajeDeErrorReparacion({ code: '22023', message: 'Elegí el modelo' }, 'x')).toBe('Elegí el modelo')
    expect(mensajeDeErrorReparacion(new Error('boom'), 'Por defecto')).toBe('Por defecto')
  })
})

describe('RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('crear sin ver_costos no envía costos y manda solo los datos del formulario', async () => {
    mocks.rpc.mockResolvedValueOnce(respuesta({ ...REPARACION, costo_mano_obra: null }))
    const creada = await crearReparacion(form({ contacto: ' 11 5555  ', numero_serie: '  ' }), false)
    expect(mocks.rpc).toHaveBeenCalledWith('crear_reparacion', {
      p_empresa_id: 'e-1',
      p_cliente_id: 'c-1',
      p_modelo_id: 'm-1',
      p_contacto: '11 5555',
      p_numero_serie: null,
      p_accesorios: '',
      p_falla: '',
      p_costo_mano_obra: null,
      p_costo_repuestos: null,
      p_tecnico_id: null,
      p_entrega_prevista: null,
    })
    expect(creada.costo_mano_obra).toBeNull()
  })

  it('crear con ver_costos convierte los importes (coma decimal) y el técnico', async () => {
    mocks.rpc.mockResolvedValueOnce(respuesta(REPARACION))
    await crearReparacion(form({
      costo_mano_obra: '120,50',
      costo_repuestos: '',
      tecnico_id: 'u-1',
      entrega_prevista: '2026-10-25',
    }), true)
    expect(mocks.rpc).toHaveBeenCalledWith('crear_reparacion', expect.objectContaining({
      p_costo_mano_obra: 120.5,
      p_costo_repuestos: 0,
      p_tecnico_id: 'u-1',
      p_entrega_prevista: '2026-10-25',
    }))
  })

  it('actualizar manda el updated_at leído (bloqueo optimista)', async () => {
    mocks.rpc.mockResolvedValueOnce(respuesta(REPARACION))
    await actualizarReparacion(REPARACION, form({ falla: 'Pantalla rota', ingreso_en: REPARACION.ingreso_en }), false)
    expect(mocks.rpc).toHaveBeenCalledWith('actualizar_reparacion', expect.objectContaining({
      p_id: 'r-1',
      p_actualizado_en: REPARACION.updated_at,
      p_falla: 'Pantalla rota',
      p_ingreso_en: REPARACION.ingreso_en,
      p_costo_mano_obra: null,
      p_costo_repuestos: null,
    }))
  })

  it('propaga el error de la base y no inventa una reparación', async () => {
    mocks.rpc.mockResolvedValueOnce(respuesta(null, { code: '40001' }))
    await expect(actualizarReparacion(REPARACION, form(), false)).rejects.toEqual({ code: '40001' })
    mocks.rpc.mockResolvedValueOnce(respuesta(null, { code: 'P0002' }))
    await expect(obtenerReparacion('r-1')).rejects.toEqual({ code: 'P0002' })
  })

  it('obtener normaliza los importes que llegan como texto', async () => {
    mocks.rpc.mockResolvedValueOnce(respuesta({ ...REPARACION, costo_mano_obra: '120.50' }))
    const obtenida = await obtenerReparacion('r-1')
    expect(obtenida.costo_mano_obra).toBe(120.5)
    expect(obtenida.codigo).toBe('R-0001')
  })

  it('lista los técnicos elegibles', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta([{ user_id: 'u-1', nombre: 'Ana' }]))
    await expect(listarTecnicos()).resolves.toEqual([{ user_id: 'u-1', nombre: 'Ana' }])
    expect(mocks.rpc).toHaveBeenCalledWith('tecnicos_de_service')
  })

  it('convierte los conteos de uso (llegan como texto) en números', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta([{ id: 'm-1', cantidad: '3' }, { id: 'm-2', cantidad: 1 }]))
    const modelos = await usoDeModelos()
    expect(modelos.get('m-1')).toBe(3)
    expect(modelos.get('m-2')).toBe(1)
    expect(modelos.get('m-3')).toBeUndefined()

    mocks.rpc.mockReturnValueOnce(respuesta(null))
    await expect(usoDeEstados()).resolves.toEqual(new Map())
  })
})

describe('textoUso', () => {
  it('concuerda en singular y plural', () => {
    expect(textoUso(1)).toBe('1 reparación')
    expect(textoUso(0)).toBe('0 reparaciones')
    expect(textoUso(5)).toBe('5 reparaciones')
  })
})

describe('Estado, entrega y anulación (F-SVC-03)', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('cambia el estado por la RPC y devuelve la reparación', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta({ ...REPARACION, estado_id: 's-2' }))
    const r = await cambiarEstadoReparacion('r-1', 's-2')
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_reparacion', { p_id: 'r-1', p_estado_id: 's-2' })
    expect(r.estado_id).toBe('s-2')
  })

  it('registra la entrega recortando quién entregó', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta(REPARACION))
    await registrarEntregaReparacion('r-1', 's-3', { entrega_real: '2026-10-20', entregado_por: '  Juan ' })
    expect(mocks.rpc).toHaveBeenCalledWith('registrar_entrega_reparacion', {
      p_id: 'r-1', p_estado_id: 's-3', p_entrega_real: '2026-10-20', p_entregado_por: 'Juan',
    })
  })

  it('anula con el motivo recortado', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta(REPARACION))
    await anularReparacion('r-1', ' Duplicada ')
    expect(mocks.rpc).toHaveBeenCalledWith('anular_reparacion', { p_id: 'r-1', p_motivo: 'Duplicada', p_consumidos: [] })
  })

  it('propaga el error de la base (no lo traga)', async () => {
    const error = { code: '55000', message: 'anulada' }
    mocks.rpc.mockReturnValueOnce(respuesta(null, error))
    await expect(cambiarEstadoReparacion('r-1', 's-2')).rejects.toBe(error)
  })

  it('lista el historial tal como lo ordena la base', async () => {
    mocks.rpc.mockReturnValueOnce(respuesta([{ id: 'h-1', tipo: 'alta' }]))
    await expect(listarHistorial('r-1')).resolves.toEqual([{ id: 'h-1', tipo: 'alta' }])
    expect(mocks.rpc).toHaveBeenCalledWith('historial_reparacion', { p_id: 'r-1' })
    mocks.rpc.mockReturnValueOnce(respuesta(null))
    await expect(listarHistorial('r-1')).resolves.toEqual([])
  })

  it('valida la entrega: fecha no anterior al ingreso ni futura, y quién entregó obligatorio', () => {
    const hoy = hoyEnArgentina()
    expect(validarEntrega({ entrega_real: hoy, entregado_por: 'Juan' }, '2026-01-01')).toEqual({})
    expect(validarEntrega({ entrega_real: '', entregado_por: 'Juan' }, '2026-01-01').entrega_real).toBe('Ingresá la fecha de entrega.')
    expect(validarEntrega({ entrega_real: '2025-12-31', entregado_por: 'Juan' }, '2026-01-01').entrega_real).toBe('La entrega no puede ser anterior al ingreso.')
    expect(validarEntrega({ entrega_real: '2999-01-01', entregado_por: 'Juan' }, '2026-01-01').entrega_real).toBe('La entrega no puede ser una fecha futura.')
    expect(validarEntrega({ entrega_real: hoy, entregado_por: '  ' }, '2026-01-01').entregado_por).toBe('Indicá quién retira o recibe el equipo.')
    expect(validarEntrega({ entrega_real: hoy, entregado_por: 'x'.repeat(201) }, '2026-01-01').entregado_por).toBe('Máximo 200 caracteres.')
    expect(formularioEntregaVacio()).toEqual({ entrega_real: hoy, entregado_por: '' })
  })

  it('valida el motivo de la anulación', () => {
    expect(validarMotivoAnulacion('  ')).toBe('Indicá el motivo de la anulación.')
    expect(validarMotivoAnulacion('x'.repeat(501))).toBe('Máximo 500 caracteres.')
    expect(validarMotivoAnulacion('Cliente desistió')).toBeNull()
  })

  it('reconoce el campo al que apunta un error de la base', () => {
    const error = { code: '22023', hint: 'motivo', message: 'Indicá el motivo de la anulación' }
    expect(errorDeCampoDe(error, ['motivo'] as const)).toEqual({ campo: 'motivo', mensaje: 'Indicá el motivo de la anulación' })
    expect(errorDeCampoDe({ ...error, hint: 'otro' }, ['motivo'] as const)).toBeNull()
    expect(errorDeCampoDe({ code: '42501' }, ['motivo'] as const)).toBeNull()
  })
})
