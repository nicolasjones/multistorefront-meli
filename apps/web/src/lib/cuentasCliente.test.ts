import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), actuales: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    from: () => ({ select: () => ({ eq: () => ({ returns: () => mocks.actuales() }) }) }),
  },
}))

import {
  formatearUltimoIngreso,
  estadoCuentaWebListado,
  estadoEfectivoCuentaWeb,
  habilitarTiendaDeCliente,
  invitarCuentaWeb,
  listarCuentasWebDeCliente,
  tiendaCuentaWeb,
  TEXTOS_ESTADO_CUENTA_WEB,
  type CuentaWeb,
} from './cuentasCliente'
import { nivelDe } from './permisos'

const CUENTA: CuentaWeb = {
  empresa_id: 'e-1', estado: 'activa', correo: 'norte@example.com', ultimo_ingreso: '2026-10-05T18:20:00Z',
}

describe('derivación de los cuatro estados (FR-002)', () => {
  it('sin fila es «Sin cuenta» y con fila guarda Activa/Suspendida', () => {
    expect(estadoEfectivoCuentaWeb(true, null)).toBe('sin_cuenta')
    expect(estadoEfectivoCuentaWeb(true, 'activa')).toBe('activa')
    expect(estadoEfectivoCuentaWeb(true, 'suspendida')).toBe('suspendida')
  })

  it('«No habilitado» prevalece sobre el estado guardado', () => {
    expect(estadoEfectivoCuentaWeb(false, 'activa')).toBe('no_habilitado')
    expect(estadoEfectivoCuentaWeb(false, 'suspendida')).toBe('no_habilitado')
    expect(estadoEfectivoCuentaWeb(false, null)).toBe('no_habilitado')
  })

  it('la tienda combina habilitación, fila guardada y correo de acceso', () => {
    expect(tiendaCuentaWeb({ id: 'e-1', nombre: 'San Javucho' }, ['e-1'], [CUENTA], 'norte@example.com')).toEqual({
      empresaId: 'e-1', nombre: 'San Javucho', habilitada: true, estado: 'activa',
      correo: 'norte@example.com', ultimoIngreso: '2026-10-05T18:20:00Z',
    })
    // Deshabilitar no borra la cuenta: queda guardada, pero el estado deriva «No habilitado».
    expect(tiendaCuentaWeb({ id: 'e-1', nombre: 'San Javucho' }, [], [CUENTA], 'norte@example.com').estado).toBe('no_habilitado')
  })

  it('los textos son los del prototipo y el «No habilitado» explica que no puede comprar', () => {
    expect(TEXTOS_ESTADO_CUENTA_WEB.activa.descripcion).toBe('Puede ingresar a las tiendas con su correo.')
    expect(TEXTOS_ESTADO_CUENTA_WEB.suspendida.descripcion).toBe('No puede ingresar hasta que la reactives.')
    expect(TEXTOS_ESTADO_CUENTA_WEB.sin_cuenta.descripcion).toBe('El cliente compra sin registrarse.')
    expect(TEXTOS_ESTADO_CUENTA_WEB.no_habilitado.descripcion).toBe('El cliente no puede comprar en esta tienda.')
  })
})

describe('columna «Cuenta web» del listado (FR-014, D4)', () => {
  it('con una tienda elegida muestra el estado de esa tienda', () => {
    const cuentas = [CUENTA, { ...CUENTA, empresa_id: 'e-2', estado: 'suspendida' as const }]
    expect(estadoCuentaWebListado(cuentas, 'e-2')).toBe('suspendida')
    expect(estadoCuentaWebListado(cuentas, 'e-3')).toBe('sin_cuenta')
  })

  it('en «Todas mis empresas»: Activa si alguna lo está, si no Suspendida, si no Sin cuenta', () => {
    expect(estadoCuentaWebListado([CUENTA, { ...CUENTA, empresa_id: 'e-2', estado: 'suspendida' }], null)).toBe('activa')
    expect(estadoCuentaWebListado([{ ...CUENTA, estado: 'suspendida' }], null)).toBe('suspendida')
    expect(estadoCuentaWebListado([], null)).toBe('sin_cuenta')
  })
})

describe('formatos', () => {
  it('«Último ingreso» usa el formato del prototipo y un guion si no hay', () => {
    expect(formatearUltimoIngreso('2026-10-05T18:20:00Z')).toMatch(/^\d{2}\/\d{2}\/2026 · \d{2}:\d{2}$/)
    expect(formatearUltimoIngreso(null)).toBe('—')
    expect(formatearUltimoIngreso('no-es-fecha')).toBe('—')
  })
})

describe('consultas y acciones', () => {
  beforeEach(() => {
    mocks.rpc.mockReset()
    mocks.invoke.mockReset()
  })

  it('lee las cuentas web del cliente por la RPC (RLS del panel)', async () => {
    mocks.rpc.mockResolvedValue({ data: [CUENTA], error: null })
    await expect(listarCuentasWebDeCliente('c-1')).resolves.toEqual([CUENTA])
    expect(mocks.rpc).toHaveBeenCalledWith('cuentas_web_de_cliente', { p_cliente: 'c-1' })
  })

  it('un error de la consulta se informa sin filtrar el texto de Postgres', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for table cuentas_cliente' } })
    await expect(listarCuentasWebDeCliente('c-1')).rejects.toThrow('No tenés permiso para gestionar cuentas web de esta tienda.')
  })

  it('crear y restablecer invocan la Edge Function con la tienda y la acción', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await invitarCuentaWeb('c-1', 'e-1')
    await invitarCuentaWeb('c-1', 'e-1', 'restablecer')
    await invitarCuentaWeb('c-1', 'e-1', 'crear', false)
    expect(mocks.invoke.mock.calls.map(([nombre, opciones]) => [nombre, opciones.body])).toEqual([
      ['invitar-cliente', { cliente_id: 'c-1', empresa_id: 'e-1', accion: 'crear', invitar: true }],
      ['invitar-cliente', { cliente_id: 'c-1', empresa_id: 'e-1', accion: 'restablecer', invitar: true }],
      ['invitar-cliente', { cliente_id: 'c-1', empresa_id: 'e-1', accion: 'crear', invitar: false }],
    ])
  })

  it('el mensaje controlado de la función llega tal cual y los demás errores son genéricos', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { error: 'Carga un correo para crear la cuenta.' }, error: null })
    await expect(invitarCuentaWeb('c-1', 'e-1')).rejects.toThrow('Carga un correo para crear la cuenta.')

    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: { json: async () => ({ error: 'No se puede crear la cuenta web con esos datos.' }) } },
    })
    await expect(invitarCuentaWeb('c-1', 'e-1')).rejects.toThrow('No se puede crear la cuenta web con esos datos.')

    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('network') })
    await expect(invitarCuentaWeb('c-1', 'e-1')).rejects.toThrow('No pudimos completar la operación.')
  })

  it('suspender y reactivar llaman la RPC de estado', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const { cambiarEstadoCuentaWeb } = await import('./cuentasCliente')
    await cambiarEstadoCuentaWeb('c-1', 'e-1', 'suspendida')
    await cambiarEstadoCuentaWeb('c-1', 'e-1', 'activa')
    expect(mocks.rpc.mock.calls.map(([nombre, args]) => [nombre, args])).toEqual([
      ['cambiar_estado_cuenta_cliente', { p_cliente: 'c-1', p_empresa: 'e-1', p_estado: 'suspendida' }],
      ['cambiar_estado_cuenta_cliente', { p_cliente: 'c-1', p_empresa: 'e-1', p_estado: 'activa' }],
    ])
  })

  it('aplicar «Activa» crea solo las tiendas sin cuenta y no reenvía invitaciones existentes (FR-015)', async () => {
    mocks.rpc.mockResolvedValue({ data: [CUENTA], error: null })
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    const { aplicarCuentaWebEnTiendas } = await import('./cuentasCliente')
    await expect(aplicarCuentaWebEnTiendas('c-1', ['e-1', 'e-2'], 'activa', true)).resolves.toEqual({ creadas: 1, errores: 0 })
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('invitar-cliente', {
      body: { cliente_id: 'c-1', empresa_id: 'e-2', accion: 'crear', invitar: true },
    })
  })

  it('aplicar «Suspendida» suspende la cuenta activa de las tiendas tildadas', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'cuentas_web_de_cliente') return { data: [CUENTA], error: null }
      return { data: null, error: null }
    })
    const { aplicarCuentaWebEnTiendas } = await import('./cuentasCliente')
    await expect(aplicarCuentaWebEnTiendas('c-1', ['e-1'], 'suspendida', false)).resolves.toEqual({ creadas: 0, errores: 0 })
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_cuenta_cliente', { p_cliente: 'c-1', p_empresa: 'e-1', p_estado: 'suspendida' })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('con estados mixtos y el campo sin cambios no reactiva ni suspende cuentas existentes, pero sí crea las nuevas', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'cuentas_web_de_cliente') return { data: [CUENTA, { ...CUENTA, empresa_id: 'e-2', estado: 'suspendida' }], error: null }
      return { data: null, error: null }
    })
    mocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })
    const { aplicarCuentaWebEnTiendas } = await import('./cuentasCliente')
    await expect(aplicarCuentaWebEnTiendas('c-1', ['e-1', 'e-2', 'e-3'], 'activa', true, 'activa')).resolves.toEqual({ creadas: 1, errores: 0 })
    expect(mocks.rpc).not.toHaveBeenCalledWith('cambiar_estado_cuenta_cliente', expect.anything())
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('con estados mixtos, elegir «Activa» desde Suspendida sí reactiva la suspendida', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'cuentas_web_de_cliente') return { data: [CUENTA, { ...CUENTA, empresa_id: 'e-2', estado: 'suspendida' }], error: null }
      return { data: null, error: null }
    })
    const { aplicarCuentaWebEnTiendas } = await import('./cuentasCliente')
    await aplicarCuentaWebEnTiendas('c-1', ['e-1', 'e-2'], 'activa', false, 'suspendida')
    expect(mocks.rpc).toHaveBeenCalledWith('cambiar_estado_cuenta_cliente', { p_cliente: 'c-1', p_empresa: 'e-2', p_estado: 'activa' })
  })

  it('un fallo de una tienda no frena el resto y se cuenta para informarlo', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    mocks.invoke
      .mockRejectedValueOnce(new Error('sin permiso'))
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
    const { aplicarCuentaWebEnTiendas } = await import('./cuentasCliente')
    await expect(aplicarCuentaWebEnTiendas('c-1', ['e-1', 'e-2'], 'activa', true)).resolves.toEqual({ creadas: 1, errores: 1 })
    expect(consola).toHaveBeenCalled()
    consola.mockRestore()
  })

  it('habilitar o deshabilitar reutiliza guardar_empresas_de_cliente y conserva la cuenta (FR-010)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    // Relee las tiendas vigentes (incluida una que otro operador sumó) en vez de usar la ficha en pantalla.
    mocks.actuales.mockResolvedValueOnce({ data: [{ empresa_id: 'e-1' }], error: null })
    await expect(habilitarTiendaDeCliente('c-1', 'e-2', true)).resolves.toEqual(['e-1', 'e-2'])
    mocks.actuales.mockResolvedValueOnce({ data: [{ empresa_id: 'e-1' }, { empresa_id: 'e-2' }], error: null })
    await expect(habilitarTiendaDeCliente('c-1', 'e-1', false)).resolves.toEqual(['e-2'])
    expect(mocks.rpc.mock.calls).toEqual([
      ['guardar_empresas_de_cliente', { p_cliente_id: 'c-1', p_empresa_ids: ['e-1', 'e-2'] }],
      ['guardar_empresas_de_cliente', { p_cliente_id: 'c-1', p_empresa_ids: ['e-2'] }],
    ])
    // Nunca borra la fila de la cuenta: solo se reemplaza la relación de tiendas.
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre.includes('cuentas_cliente'))).toBe(false)
  })
})

describe('Acceso restringido de la cuenta web al panel (FR-006, SC-002)', () => {
  it('sin membresía no hay permisos y la sección Clientes queda en «ninguno» (Acceso restringido)', () => {
    // `permisos_actuales` devuelve las secciones de la membresía del panel; una
    // cuenta web no tiene fila en usuarios_organizacion, así que la lista vacía
    // deriva «ninguno» y RequiereAccesoSeccion muestra «Acceso restringido».
    expect(nivelDe([], 'clientes')).toBe('ninguno')
  })
})
