import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

// Pestaña «Motos» de Transportes (F-VTA-24 y F-VTA-25, MSF-145): listado, registro/edición,
// rendición por fila y en lote, tarjeta «Motos sin rendir» y cambio de empresa activa.
// La pantalla no usa `Date`: las fechas llegan de la base como AAAA-MM-DD y solo se reformatean.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  listarTransportes: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
  useNivelSeccion: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../../lib/ventas/transportes', async (importar) => ({
  ...(await importar<typeof import('../../../lib/ventas/transportes')>()),
  listarTransportes: mocks.listarTransportes,
}))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: mocks.useNivelSeccion }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../components/ventas/TransporteDialog', () => ({ TransporteDialog: () => null }))

import type { EnvioMoto } from '../../../lib/ventas/enviosMoto'
import { TransporteList } from './list'

const envio = (extra: Partial<EnvioMoto> = {}): EnvioMoto => ({
  id: 'm-1',
  comprobante_id: 'f-1',
  comprobante_numero: '0003-00001247',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  fecha: '2026-10-07',
  cliente: 'Kiosco La Esquina',
  mensajero: 'Moto 1',
  guia: 'M-2201',
  costo_envio: 3500,
  abono: 92800,
  enviado: true,
  rendido: false,
  rendido_en: null,
  actualizado_en: '2026-10-07T10:00:00+00:00',
  puede_editar: true,
  puede_rendir: true,
  ...extra,
})

type Estado = { envios: EnvioMoto[]; total?: number; resumen: { monto: number; entregas: number }; puedeRegistrar?: boolean }

// Doble de las RPC de la pantalla: cada prueba puede reescribir el `estado` que necesita.
const rpcMotos = (estado: Estado) => vi.fn(async (nombre: string, args?: Record<string, unknown>) => {
  switch (nombre) {
    case 'listar_envios_moto':
      return {
        data: estado.envios.map((e) => ({ ...e, costo_envio: String(e.costo_envio), abono: String(e.abono), filas: estado.total ?? estado.envios.length })),
        error: null,
      }
    case 'resumen_motos_sin_rendir':
      return { data: [{ monto: String(estado.resumen.monto), entregas: String(estado.resumen.entregas) }], error: null }
    case 'rendir_envios_moto': {
      const ids = (args?.p_ids ?? []) as string[]
      const elegidos = estado.envios.filter((e) => ids.includes(e.id))
      const total_abono = elegidos.reduce((s, e) => s + e.abono, 0)
      const total_costo = elegidos.reduce((s, e) => s + e.costo_envio, 0)
      return { data: { cantidad: elegidos.length, mensajero: elegidos[0]?.mensajero ?? null, total_abono, total_costo, neto: total_abono - total_costo }, error: null }
    }
    case 'comprobantes_para_envio_moto':
      return { data: [{ id: 'f-9', numero: '0003-00001300', empresa_id: 'e-1', empresa: 'San Javucho', fecha: '2026-10-08', cliente: 'Cliente Nuevo' }], error: null }
    case 'puedo_registrar_envios_moto':
      return { data: estado.puedeRegistrar ?? true, error: null }
    case 'registrar_envio_moto':
      return { data: { id: 'm-nuevo' }, error: null }
    case 'actualizar_envio_moto':
      return { data: { id: 'm-1' }, error: null }
    default:
      return { data: [], error: null }
  }
})

const empresas = (activa: 'e-1' | 'e-2' = 'e-1') => ({
  empresas: [
    { id: 'e-1', nombre: 'San Javucho', esActiva: activa === 'e-1' },
    { id: 'e-2', nombre: 'Mundo JC', esActiva: activa === 'e-2' },
  ],
  empresaActivaId: activa,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
})

const pantalla = (url = '/ventas/transportes?pestana=motos') => (
  <MemoryRouter initialEntries={[url]}><TransporteList /></MemoryRouter>
)

const llamadas = (nombre: string) => mocks.rpc.mock.calls.filter(([n]) => n === nombre)

const ESTADO_BASE: Estado = {
  envios: [
    envio(),
    envio({ id: 'm-2', comprobante_id: 'f-2', comprobante_numero: '0003-00001241', cliente: 'Cellmax SRL', mensajero: 'Moto 2', guia: null, abono: 0, enviado: false }),
    envio({ id: 'm-3', comprobante_id: 'f-3', comprobante_numero: '0003-00001236', cliente: null, fecha: '2026-10-06', abono: 28400, costo_envio: 3000, rendido: true, rendido_en: '2026-10-07T12:00:00+00:00' }),
  ],
  resumen: { monto: 92800, entregas: 1 },
}

describe('Transportes · pestaña Motos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useNivelSeccion.mockReturnValue({ nivel: 'edicion', isLoading: false, error: false })
    mocks.useEmpresasAccesibles.mockReturnValue(empresas())
    mocks.rpc.mockImplementation(rpcMotos(ESTADO_BASE))
    mocks.listarTransportes.mockResolvedValue({ transportes: [], total: 0, totalOrganizacion: 0 })
  })

  it('sin parámetro abre Contrarreembolsos y suma «Motos» entre las pestañas (sin quitar ninguna)', async () => {
    render(pantalla('/ventas/transportes'))
    const pestanas = screen.getAllByRole('tab')
    expect(pestanas.map((p) => p.textContent)).toEqual(['Contrarreembolsos', 'Motos', 'Terminales de retiro'])
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true')
    expect(llamadas('listar_envios_moto')).toHaveLength(0)
    await screen.findByText('Todavía no hay contrarreembolsos.')
  })

  it('un parámetro desconocido cae en la pestaña por defecto', async () => {
    render(pantalla('/ventas/transportes?pestana=inventada'))
    expect(screen.getByRole('tab', { name: 'Contrarreembolsos' })).toHaveAttribute('aria-selected', 'true')
    await screen.findByText('Todavía no hay contrarreembolsos.')
  })

  it('?pestana=motos abre la pestaña con su ayuda y al elegirla desde el control también', async () => {
    render(pantalla('/ventas/transportes'))
    fireEvent.click(screen.getByRole('tab', { name: 'Motos' }))
    expect(screen.getByRole('tab', { name: 'Motos' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Mensajería propia: se rinde el efectivo cobrado y el costo del envío.')).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Envíos en moto' })).toBeInTheDocument()
  })

  it('lista las columnas y formatos del prototipo (dd/mm, importes, «—», etiquetas y enlace al comprobante)', async () => {
    render(pantalla())
    const tabla = await screen.findByRole('table', { name: 'Envíos en moto' })
    for (const nombre of ['Fecha', 'Tienda', 'Comprobante', 'Cliente', 'Mensajero', 'Guía', 'Costo de envío', 'Abona al recibir', 'Enviado', 'Rendido']) {
      expect(within(tabla).getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    const fila = within(tabla).getByText('Kiosco La Esquina').closest('tr') as HTMLElement
    expect(within(fila).getByText('07/10')).toBeInTheDocument()
    expect(within(fila).getByText('San Javucho')).toBeInTheDocument()
    expect(within(fila).getByRole('link', { name: '0003-00001247' })).toHaveAttribute('href', '/ventas/comprobantes/f-1')
    expect(within(fila).getByText('Moto 1')).toBeInTheDocument()
    expect(within(fila).getByText('M-2201')).toBeInTheDocument()
    expect(within(fila).getByText('$ 3.500')).toBeInTheDocument()
    expect(within(fila).getByText('$ 92.800')).toBeInTheDocument()
    expect(within(fila).getByText('Enviado')).toBeInTheDocument()
    // Sin abono ni guía: «—»; sin enviar: «Por enviar»; sin cliente legible: «—».
    const porEnviar = within(tabla).getByText('Cellmax SRL').closest('tr') as HTMLElement
    expect(within(porEnviar).getAllByText('—').length).toBe(2)
    expect(within(porEnviar).getByText('Por enviar')).toBeInTheDocument()
    const sinCliente = within(tabla).getByRole('link', { name: '0003-00001236' }).closest('tr') as HTMLElement
    expect(within(sinCliente).getAllByText('—').length).toBeGreaterThan(0)
    // Sin ids técnicos a la vista ni la tabla de contrarreembolsos.
    expect(screen.queryByText('m-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Contrarreembolsos' })).not.toBeInTheDocument()
    expect(await screen.findByText('3 envíos en moto')).toBeInTheDocument()
  })

  it('la tarjeta «Motos sin rendir» muestra el monto y las entregas, y pide la tienda activa', async () => {
    render(pantalla())
    const tarjeta = await screen.findByRole('region', { name: 'Motos sin rendir' })
    await waitFor(() => expect(within(tarjeta).getByText('$ 92.800')).toBeInTheDocument())
    expect(within(tarjeta).getByText('1 entrega')).toBeInTheDocument()
    expect(llamadas('resumen_motos_sin_rendir').at(-1)?.[1]).toEqual({ p_empresa_id: 'e-1' })
  })

  it('si falla el resumen la tarjeta dice «Sin datos» en vez de inventar un total', async () => {
    const base = rpcMotos(ESTADO_BASE)
    mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) =>
      nombre === 'resumen_motos_sin_rendir' ? { data: null, error: { code: 'XX000', message: 'caída' } } : base(nombre, args))
    render(pantalla())
    const tarjeta = await screen.findByRole('region', { name: 'Motos sin rendir' })
    await waitFor(() => expect(within(tarjeta).getByText('Sin datos')).toBeInTheDocument())
  })

  describe('permisos de la pantalla', () => {
    it('con edición ve «Registrar envío» y «Editar» (según permiso de la fila)', async () => {
      mocks.rpc.mockImplementation(rpcMotos({ ...ESTADO_BASE, envios: [envio(), envio({ id: 'm-2', comprobante_numero: '0003-00001241', cliente: 'Cellmax SRL', puede_editar: false })] }))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(await screen.findByRole('button', { name: 'Registrar envío' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Editar 0003-00001247' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Editar 0003-00001241' })).not.toBeInTheDocument()
    })

    it('con ventas en edición pero sin poder registrar (Mostrador): no ve «Registrar envío»', async () => {
      mocks.rpc.mockImplementation(rpcMotos({ ...ESTADO_BASE, puedeRegistrar: false }))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      await waitFor(() => expect(llamadas('puedo_registrar_envios_moto')).toHaveLength(1))
      expect(screen.queryByRole('button', { name: 'Registrar envío' })).not.toBeInTheDocument()
    })

    it('si el servidor no responde a la consulta de permiso, no muestra «Registrar envío»', async () => {
      const errorado = vi.spyOn(console, 'error').mockImplementation(() => {})
      const base = rpcMotos(ESTADO_BASE)
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) =>
        nombre === 'puedo_registrar_envios_moto' ? { data: null, error: { code: 'XX000', message: 'caída' } } : base(nombre, args))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      await waitFor(() => expect(llamadas('puedo_registrar_envios_moto')).toHaveLength(1))
      expect(screen.queryByRole('button', { name: 'Registrar envío' })).not.toBeInTheDocument()
      errorado.mockRestore()
    })

    it('solo lectura: ve la lista sin «Registrar envío», «Editar», casillas ni «Rendir seleccionados»', async () => {
      mocks.useNivelSeccion.mockReturnValue({ nivel: 'lectura', isLoading: false, error: false })
      mocks.rpc.mockImplementation(rpcMotos({
        ...ESTADO_BASE,
        envios: ESTADO_BASE.envios.map((e) => ({ ...e, puede_editar: false, puede_rendir: false })),
      }))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.queryByRole('button', { name: 'Registrar envío' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Rendir seleccionados/ })).not.toBeInTheDocument()
      // Y las llaves existen pero no se pueden accionar.
      for (const llave of screen.getAllByRole('switch')) expect(llave).toBeDisabled()
    })
  })

  describe('estados', () => {
    it('mientras carga muestra el estado de carga', async () => {
      let resolver: (valor: unknown) => void = () => undefined
      const base = rpcMotos(ESTADO_BASE)
      mocks.rpc.mockImplementation((nombre: string, args?: Record<string, unknown>) =>
        nombre === 'listar_envios_moto' ? new Promise((resuelve) => { resolver = resuelve }) : base(nombre, args))
      render(pantalla())
      expect(await screen.findByLabelText('Cargando contenido')).toBeInTheDocument()
      resolver({ data: [], error: null })
      await waitFor(() => expect(screen.queryByLabelText('Cargando contenido')).not.toBeInTheDocument())
    })

    it('sin envíos: vacío con la invitación a registrar el primero', async () => {
      mocks.rpc.mockImplementation(rpcMotos({ envios: [], resumen: { monto: 0, entregas: 0 } }))
      render(pantalla())
      expect(await screen.findByText('Todavía no hay envíos en moto.')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Registrar envío' }).length).toBeGreaterThan(0)
      expect(within(screen.getByRole('region', { name: 'Motos sin rendir' })).getByText('0 entregas')).toBeInTheDocument()
    })

    it('si falla la carga muestra el error y «Reintentar» vuelve a pedir', async () => {
      const base = rpcMotos(ESTADO_BASE)
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) =>
        nombre === 'listar_envios_moto' && llamadas('listar_envios_moto').length === 1
          ? { data: null, error: { code: 'XX000', message: 'caída' } }
          : base(nombre, args))
      render(pantalla())
      expect(await screen.findByText('No pudimos cargar los envíos en moto.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
      expect(await screen.findByText('Kiosco La Esquina')).toBeInTheDocument()
    })

    it('«Cargar más» pide la tanda 2 y la suma a la ya mostrada', async () => {
      const base = rpcMotos({ ...ESTADO_BASE, total: 2 })
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) => {
        if (nombre !== 'listar_envios_moto') return base(nombre, args)
        const f = args?.p_pagina === 2 ? envio({ id: 'm-26', comprobante_numero: '0003-00002000', cliente: 'Cliente 26' }) : envio()
        return { data: [{ ...f, filas: 2 }], error: null }
      })
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.queryByRole('button', { name: /next page|siguiente/i })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }))
      expect(await screen.findByText('Cliente 26')).toBeInTheDocument()
      expect(screen.getByText('Kiosco La Esquina')).toBeInTheDocument()
      expect(llamadas('listar_envios_moto').at(-1)?.[1]).toMatchObject({ p_pagina: 2, p_tamano: 25 })
    })

    it('el filtro Tienda pide esa tienda al servidor (listado y tarjeta) y vuelve a la tanda 1', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      // Por defecto sigue a la empresa activa de la barra superior.
      expect(llamadas('listar_envios_moto').at(-1)?.[1]).toEqual({ p_empresa_id: 'e-1', p_pagina: 1, p_tamano: 25 })
      fireEvent.click(screen.getByRole('button', { name: 'Todas las tiendas' }))
      await waitFor(() => expect(llamadas('listar_envios_moto').at(-1)?.[1]).toEqual({ p_empresa_id: null, p_pagina: 1, p_tamano: 25 }))
      await waitFor(() => expect(llamadas('resumen_motos_sin_rendir').at(-1)?.[1]).toEqual({ p_empresa_id: null }))
      expect(screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.')).toBeInTheDocument()
    })

    it('con una tienda elegida y sin envíos avisa que esa tienda no tiene', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      mocks.rpc.mockImplementation(rpcMotos({ envios: [], resumen: { monto: 0, entregas: 0 } }))
      fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
      expect(await screen.findByText('Esa tienda no tiene envíos en moto.')).toBeInTheDocument()
    })
  })

  describe('registro y edición (F-VTA-24)', () => {
    it('«Registrar envío» abre el diálogo, registra con mensajero, avisa y recarga', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Registrar envío en moto' })
      fireEvent.keyDown(within(dialogo).getByRole('combobox', { name: /Comprobante/ }), { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('option', { name: '0003-00001300 · Cliente Nuevo' }))
      fireEvent.change(within(dialogo).getByLabelText(/Mensajero/), { target: { value: '  Moto 3  ' } })
      fireEvent.change(within(dialogo).getByLabelText('Costo de envío', { exact: false }), { target: { value: '3500' } })
      fireEvent.change(within(dialogo).getByLabelText('Abona al recibir', { exact: false }), { target: { value: '1200,50' } })
      const antes = llamadas('listar_envios_moto').length
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Registrar envío' }))
      expect(await screen.findByText('Envío registrado')).toBeInTheDocument()
      expect(llamadas('registrar_envio_moto')[0][1]).toEqual({
        p_comprobante_id: 'f-9', p_mensajero: 'Moto 3', p_guia: null, p_costo_envio: 3500, p_abono: 1200.5, p_enviado: false,
      })
      await waitFor(() => expect(llamadas('listar_envios_moto').length).toBeGreaterThan(antes))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('«Editar» abre el mismo diálogo con los valores actuales y guarda con la versión leída', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      fireEvent.click(screen.getByRole('button', { name: 'Editar 0003-00001247' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Editar envío en moto' })
      expect(within(dialogo).getByLabelText(/Mensajero/)).toHaveValue('Moto 1')
      expect(within(dialogo).getByLabelText('Guía')).toHaveValue('M-2201')
      expect(within(dialogo).getByLabelText('Costo de envío', { exact: false })).toHaveValue('3500')
      fireEvent.change(within(dialogo).getByLabelText(/Mensajero/), { target: { value: 'Moto 9' } })
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }))
      expect(await screen.findByText('Envío actualizado')).toBeInTheDocument()
      expect(llamadas('actualizar_envio_moto')[0][1]).toMatchObject({
        p_id: 'm-1', p_mensajero: 'Moto 9', p_actualizado_en: '2026-10-07T10:00:00+00:00',
      })
    })

    it('un envío rendido no se puede editar (solo lectura)', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.getByRole('button', { name: 'Editar 0003-00001236' })).toBeDisabled()
    })
  })

  describe('rendición (F-VTA-25)', () => {
    it('la llave «Rendido» rinde la fila, avisa «Entrega rendida» y recalcula la tarjeta', async () => {
      const estado = { ...ESTADO_BASE }
      const base = rpcMotos(estado)
      let rendido = false
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) => {
        if (nombre === 'rendir_envios_moto') rendido = true
        if (nombre === 'resumen_motos_sin_rendir' && rendido) return { data: [{ monto: 0, entregas: 0 }], error: null }
        return base(nombre, args)
      })
      render(pantalla())
      const tarjeta = await screen.findByRole('region', { name: 'Motos sin rendir' })
      await waitFor(() => expect(within(tarjeta).getByText('1 entrega')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('switch', { name: 'Rendido · 0003-00001247' }))
      expect(await screen.findByText('Entrega rendida')).toBeInTheDocument()
      expect(llamadas('rendir_envios_moto')[0][1]).toEqual({ p_ids: ['m-1'] })
      await waitFor(() => expect(within(tarjeta).getByText('0 entregas')).toBeInTheDocument())
      expect(screen.queryByText('Rendición revertida')).not.toBeInTheDocument()
    })

    it('la llave se deshabilita sin enviar, ya rendida o sin ser Administrador, y una rendida no se apaga', async () => {
      mocks.rpc.mockImplementation(rpcMotos({
        ...ESTADO_BASE,
        envios: [...ESTADO_BASE.envios, envio({ id: 'm-4', comprobante_numero: '0003-00001999', cliente: 'Otra Tienda', puede_rendir: false })],
      }))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.getByRole('switch', { name: 'Rendido · 0003-00001247' })).toBeEnabled()
      expect(screen.getByRole('switch', { name: 'Rendido · 0003-00001241' })).toBeDisabled()
      const rendida = screen.getByRole('switch', { name: 'Rendido · 0003-00001236' })
      expect(rendida).toBeChecked()
      expect(rendida).toBeDisabled()
      expect(screen.getByRole('switch', { name: 'Rendido · 0003-00001999' })).toBeDisabled()
      fireEvent.click(rendida)
      expect(llamadas('rendir_envios_moto').map(([, a]) => a)).toEqual([])
    })

    it('si la base rechaza la rendición de la fila lo dice con un mensaje claro', async () => {
      const base = rpcMotos(ESTADO_BASE)
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) =>
        nombre === 'rendir_envios_moto' ? { data: null, error: { code: '42501', message: 'x' } } : base(nombre, args))
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      fireEvent.click(screen.getByRole('switch', { name: 'Rendido · 0003-00001247' }))
      expect(await screen.findByText(/Solo el Administrador puede rendir/)).toBeInTheDocument()
    })

    it('las casillas solo se ofrecen en filas enviadas y sin rendir; «seleccionar todo» elige solo esas', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00001241 de Moto 2' })).toBeDisabled()
      expect(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00001236 de Moto 1' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Rendir seleccionados' })).toBeDisabled()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
      expect(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00001247 de Moto 1' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00001241 de Moto 2' })).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Rendir seleccionados (1)' })).toBeEnabled()
    })

    const ESTADO_LOTE: Estado = {
      envios: [
        envio({ id: 'a', comprobante_numero: '0003-00000001', cliente: 'Cliente A', mensajero: 'Moto 1', abono: 1000.1, costo_envio: 300.2 }),
        envio({ id: 'b', comprobante_numero: '0003-00000002', cliente: 'Cliente B', mensajero: ' moto 1 ', abono: 2000.2, costo_envio: 400.1 }),
        envio({ id: 'c', comprobante_numero: '0003-00000003', cliente: 'Cliente C', mensajero: 'Moto 2', abono: 500, costo_envio: 100 }),
      ],
      resumen: { monto: 3500.3, entregas: 3 },
    }

    it('rinde en lote: el diálogo muestra cantidad, efectivo, costo, total y neto; confirma todo junto', async () => {
      mocks.rpc.mockImplementation(rpcMotos(ESTADO_LOTE))
      render(pantalla())
      await screen.findByText('Cliente A')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00000001 de Moto 1' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00000002 de moto 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rendir seleccionados (2)' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Rendir entregas' })
      const valor = (etiqueta: string) => within(dialogo).getByText(etiqueta).nextElementSibling?.textContent
      expect(valor('Entregas')).toBe('2')
      expect(valor('Efectivo cobrado')).toBe('$ 3.000,30')
      expect(valor('Costo de envíos')).toBe('$ 700,30')
      // El total a rendir es el efectivo cobrado: el costo no se resta; el neto es informativo.
      expect(valor('Total a rendir')).toBe('$ 3.000,30')
      expect(valor('Neto')).toBe('$ 2.300')
      expect(within(dialogo).getByText('Moto 1')).toBeInTheDocument()
      fireEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar rendición' }))
      expect(await screen.findByText('Entrega rendida')).toBeInTheDocument()
      expect(llamadas('rendir_envios_moto')[0][1]).toEqual({ p_ids: ['a', 'b'] })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('bloquea la confirmación si la selección mezcla mensajeros', async () => {
      mocks.rpc.mockImplementation(rpcMotos(ESTADO_LOTE))
      render(pantalla())
      await screen.findByText('Cliente A')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rendir seleccionados (3)' }))
      const dialogo = await screen.findByRole('dialog', { name: 'Rendir entregas' })
      expect(within(dialogo).getByText(/mezcla mensajeros \(Moto 1, Moto 2\)/)).toBeInTheDocument()
      expect(within(dialogo).getByRole('button', { name: 'Confirmar rendición' })).toBeDisabled()
      expect(llamadas('rendir_envios_moto')).toHaveLength(0)
    })

    it('si el lote falla la base aborta todo y el diálogo muestra el motivo sin cerrarse', async () => {
      const base = rpcMotos(ESTADO_LOTE)
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) =>
        nombre === 'rendir_envios_moto' ? { data: null, error: { code: '22023', message: 'Un envío no está enviado.' } } : base(nombre, args))
      render(pantalla())
      await screen.findByText('Cliente A')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00000001 de Moto 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rendir seleccionados (1)' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Confirmar rendición' }))
      expect(await screen.findByText('Un envío no está enviado.')).toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Rendir entregas' })).toBeInTheDocument()
    })
  })

  describe('cambio de empresa activa (Principio VIII, FR-007 y FR-025)', () => {
    it('recarga todo, vuelve a la tanda 1, cierra el diálogo con aviso y no deja filas ajenas', async () => {
      const base = rpcMotos(ESTADO_BASE)
      mocks.rpc.mockImplementation(async (nombre: string, args?: Record<string, unknown>) => {
        if (nombre === 'listar_envios_moto' && args?.p_empresa_id === 'e-2') {
          return { data: [{ ...envio({ id: 'x-1', comprobante_numero: '0009-00000001', cliente: 'Cliente Mundo', empresa_id: 'e-2', empresa: 'Mundo JC' }), filas: 1 }], error: null }
        }
        return base(nombre, args)
      })
      const { rerender } = render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar 0003-00001247 de Moto 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Rendir seleccionados (1)' }))
      expect(await screen.findByRole('dialog', { name: 'Rendir entregas' })).toBeInTheDocument()

      mocks.useEmpresasAccesibles.mockReturnValue(empresas('e-2'))
      rerender(pantalla())

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await screen.findByText(/Cambió la empresa activa/)).toBeInTheDocument()
      expect(await screen.findByText('Cliente Mundo')).toBeInTheDocument()
      expect(screen.queryByText('Kiosco La Esquina')).not.toBeInTheDocument()
      expect(llamadas('listar_envios_moto').at(-1)?.[1]).toEqual({ p_empresa_id: 'e-2', p_pagina: 1, p_tamano: 25 })
      await waitFor(() => expect(llamadas('resumen_motos_sin_rendir').at(-1)?.[1]).toEqual({ p_empresa_id: 'e-2' }))
      // La selección se descartó: nada queda marcado ni listo para rendir.
      expect(screen.getByRole('button', { name: 'Rendir seleccionados' })).toBeDisabled()
    })

    it('cierra también el diálogo de registro con aviso', async () => {
      const { rerender } = render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      fireEvent.click(screen.getByRole('button', { name: 'Registrar envío' }))
      expect(await screen.findByRole('dialog', { name: 'Registrar envío en moto' })).toBeInTheDocument()
      mocks.useEmpresasAccesibles.mockReturnValue(empresas('e-2'))
      rerender(pantalla())
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(await screen.findByText(/Cambió la empresa activa/)).toBeInTheDocument()
    })

    it('mientras llega la respuesta de la tienda nueva no muestra las filas de la anterior', async () => {
      const base = rpcMotos(ESTADO_BASE)
      let resolver: (valor: unknown) => void = () => undefined
      mocks.rpc.mockImplementation((nombre: string, args?: Record<string, unknown>) =>
        nombre === 'listar_envios_moto' && args?.p_empresa_id === 'e-2'
          ? new Promise((resuelve) => { resolver = resuelve })
          : base(nombre, args))
      const { rerender } = render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      mocks.useEmpresasAccesibles.mockReturnValue(empresas('e-2'))
      rerender(pantalla())
      await waitFor(() => expect(screen.queryByText('Kiosco La Esquina')).not.toBeInTheDocument())
      expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
      resolver({ data: [], error: null })
    })
  })

  describe('accesibilidad', () => {
    it.each([320, 768, 1440])('no tiene violaciones de accesibilidad a %i px', async (ancho) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho })
      const { container } = render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(await violacionesAxe(container)).toEqual([])
    })

    it('el panel de la pestaña queda asociado a su pestaña y las llaves son operables con teclado', async () => {
      render(pantalla())
      await screen.findByText('Kiosco La Esquina')
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'transportes-tab-motos')
      const llave = screen.getByRole('switch', { name: 'Rendido · 0003-00001247' })
      llave.focus()
      expect(llave).toHaveFocus()
    })
  })
})
