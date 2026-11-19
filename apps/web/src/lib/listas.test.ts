import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { LARGO_MAXIMO_ITEM_LISTA, cambiarActivoEstadoConsulta, crearEstadoConsulta, mensajeDeErrorLista, renombrarEstadoConsulta, validarNombreItem } from './listas'

describe('validarNombreItem', () => {
  it('rechaza vacío o solo espacios y acepta el largo máximo exacto', () => {
    expect(validarNombreItem('   ')).toBe('Ingresá un nombre.')
    expect(validarNombreItem('a'.repeat(LARGO_MAXIMO_ITEM_LISTA))).toBeNull()
    expect(validarNombreItem('a'.repeat(LARGO_MAXIMO_ITEM_LISTA + 1))).toBe(`Máximo ${LARGO_MAXIMO_ITEM_LISTA} caracteres.`)
  })

  it('mide el largo sin contar los espacios de los bordes', () => {
    expect(validarNombreItem(` ${'a'.repeat(LARGO_MAXIMO_ITEM_LISTA)} `)).toBeNull()
  })
})

describe('mensajeDeErrorLista', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it('traduce los códigos de la base', () => {
    expect(mensajeDeErrorLista({ code: '42501' }, 'x')).toMatch(/No tenés permiso/)
    expect(mensajeDeErrorLista({ code: '23514', message: 'vacío' }, 'x')).toBe('El nombre no puede estar vacío.')
    expect(mensajeDeErrorLista({ code: '23505' }, 'x')).toBe('Ya existe un estado con ese nombre.')
    expect(mensajeDeErrorLista({ code: 'P0002' }, 'x')).toMatch(/ya no existe/)
  })

  it('muestra tal cual el mensaje de la guarda de estados de sistema', () => {
    const mensaje = 'El estado de sistema no se puede renombrar'
    expect(mensajeDeErrorLista({ code: '23514', message: mensaje }, 'x')).toBe(mensaje)
  })

  it('devuelve el mensaje por defecto para errores desconocidos', () => {
    expect(mensajeDeErrorLista(undefined, 'Falló')).toBe('Falló')
  })
})

describe('escrituras de estados de consulta', () => {
  beforeEach(() => mocks.rpc.mockReset())

  it('crear y renombrar mandan el nombre recortado', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await crearEstadoConsulta('  Nuevo  ')
    expect(mocks.rpc).toHaveBeenLastCalledWith('crear_estado_consulta', { p_nombre: 'Nuevo' })
    await renombrarEstadoConsulta('e-1', ' Otro ')
    expect(mocks.rpc).toHaveBeenLastCalledWith('renombrar_estado_consulta', { p_id: 'e-1', p_nombre: 'Otro' })
  })

  it('activar o desactivar usa la RPC de cambio de estado y propaga los errores', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await cambiarActivoEstadoConsulta('e-1', false)
    expect(mocks.rpc).toHaveBeenLastCalledWith('cambiar_estado_estado_consulta', { p_id: 'e-1', p_activo: false })
    mocks.rpc.mockResolvedValue({ error: { code: '23505' } })
    await expect(crearEstadoConsulta('x')).rejects.toMatchObject({ code: '23505' })
  })
})
