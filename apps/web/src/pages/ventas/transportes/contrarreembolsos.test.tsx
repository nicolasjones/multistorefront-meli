import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Test de la pantalla «Transportes y contrarreembolsos» (F-VTA-14, FR-046, FR-047 y FR-048) y de
// los envoltorios de sus RPC (FR-045). SC-006 lo cierra la última tarea de la historia.
vi.setConfig({ testTimeout: 20000 })

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  listarTransportes: vi.fn(),
  usePuedeEscribir: vi.fn(),
  useEmpresasAccesibles: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../../lib/ventas/transportes', async (importar) => ({
  ...(await importar<typeof import('../../../lib/ventas/transportes')>()),
  listarTransportes: mocks.listarTransportes,
}))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: mocks.useEmpresasAccesibles }))
vi.mock('../../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: null, isLoading: false }) }))
vi.mock('../../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../../components/ventas/TransporteDialog', () => ({ TransporteDialog: () => null }))

import {
  type Contrarreembolso,
  type ContrarreembolsoCobrado,
  listarContrarreembolsos,
  marcarContrarreembolsoCobrado,
  mensajeDeErrorContrarreembolso,
  resumenContrarreembolsos,
} from '../../../lib/ventas/contrarreembolsos'
import { TransporteList } from './list'

const fila = (extra: Partial<Contrarreembolso> = {}): Contrarreembolso => ({
  id: 'cr-1',
  fecha: '2026-12-01T10:00:00+00:00',
  empresa_id: 'e-1',
  empresa: 'San Javucho',
  comprobante_id: 'f-1',
  numero: '0001-00000001',
  cliente: 'Cliente Uno',
  transporte_id: 't-1',
  transporte: 'Expreso Uno',
  guia: 'G-0001',
  importe: 1000,
  estado: 'pendiente',
  actualizado_en: '2026-12-01T10:00:00+00:00',
  ...extra,
})

// Lo que devuelve `public.marcar_contrarreembolso_cobrado`: la fila de
// `dominio.contrarreembolsos` (la RPC devuelve la tabla, no el listado). Los nombres de la
// tienda, la factura y el transporte NO vienen: salen de los `join` del listado.
const filaCobrada = (extra: Partial<ContrarreembolsoCobrado> = {}): ContrarreembolsoCobrado => ({
  id: 'cr-1',
  organizacion_id: 'org-1',
  empresa_id: 'e-1',
  comprobante_id: 'f-1',
  transporte_id: 't-1',
  guia: 'G-0001',
  importe: 1000,
  estado: 'cobrado',
  cobrado_por: 'd-2',
  cobrado_por_nombre: 'Administración',
  cobrado_en: '2026-12-02T10:00:00+00:00',
  cobro_id: 'cobro-1',
  creado_en: '2026-12-01T10:00:00+00:00',
  actualizado_en: '2026-12-02T10:00:00+00:00',
  ...extra,
})

// La tabla y las tarjetas se dibujan con un `Link` al comprobante: la pantalla necesita un router.
const renderPantalla = () => render(<MemoryRouter><TransporteList /></MemoryRouter>)

describe('envoltorios de los contrarreembolsos (FR-045)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('listar pide la página a la RPC y devuelve las filas con el importe en número', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...fila(), importe: '1000.50', filas: 3 }], error: null })
    const resultado = await listarContrarreembolsos({ empresaId: 'e-1', estado: 'pendiente', pagina: 2, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', {
      p_empresa_id: 'e-1',
      p_estado: 'pendiente',
      p_pagina: 2,
      p_tamano: 10,
    })
    expect(resultado.contrarreembolsos[0].importe).toBe(1000.5)
    expect(resultado.total).toBe(3)
  })

  it('sin filtro de estado la RPC recibe null (los dos estados)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarContrarreembolsos({ empresaId: null, estado: null, pagina: 1, tamano: 10 })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', {
      p_empresa_id: null,
      p_estado: null,
      p_pagina: 1,
      p_tamano: 10,
    })
  })

  it('un estado que no existe no viaja a la base', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await listarContrarreembolsos({
      empresaId: null,
      estado: 'inventado' as never,
      pagina: 1,
      tamano: 10,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', expect.objectContaining({ p_estado: null }))
  })

  it('el resumen trae los tres totales de las tarjetas', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ pendiente_importe: '1000.50', pendiente_cantidad: '2', cobrado_mes_importe: '1500' }],
      error: null,
    })
    const resumen = await resumenContrarreembolsos('e-1')
    expect(mocks.rpc).toHaveBeenCalledWith('resumen_contrarreembolsos', { p_empresa_id: 'e-1' })
    expect(resumen).toEqual({ pendiente_importe: 1000.5, pendiente_cantidad: 2, cobrado_mes_importe: 1500 })
  })

  it('marcar cobrado viaja con el id y la versión leída en pantalla', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...filaCobrada(), importe: '1000' }, error: null })
    const resultado = await marcarContrarreembolsoCobrado('cr-1', '2026-12-01T10:00:00+00:00')
    expect(mocks.rpc).toHaveBeenCalledWith('marcar_contrarreembolso_cobrado', {
      p_id: 'cr-1',
      p_actualizado_en: '2026-12-01T10:00:00+00:00',
    })
    expect(resultado.estado).toBe('cobrado')
    expect(resultado.importe).toBe(1000)
  })

  it('marcar cobrado devuelve la fila del contrarreembolso, no la del listado', async () => {
    mocks.rpc.mockResolvedValue({ data: filaCobrada(), error: null })
    const resultado = await marcarContrarreembolsoCobrado('cr-1', '2026-12-01T10:00:00+00:00')
    // La RPC devuelve `dominio.contrarreembolsos`: los nombres de la tienda, la factura y el
    // transporte salen de los `join` del listado y NO están acá.
    expect(resultado.cobro_id).toBe('cobro-1')
    expect(resultado.cobrado_por_nombre).toBe('Administración')
    expect(resultado.cobrado_en).toBe('2026-12-02T10:00:00+00:00')
    expect(resultado).not.toHaveProperty('empresa')
    expect(resultado).not.toHaveProperty('numero')
    expect(resultado).not.toHaveProperty('cliente')
    expect(resultado).not.toHaveProperty('transporte')
  })

  it('sin id o sin versión no se intenta marcar y se avisa con un mensaje claro', async () => {
    await expect(marcarContrarreembolsoCobrado('', '2026-12-01T10:00:00+00:00')).rejects.toThrow(/id/)
    await expect(marcarContrarreembolsoCobrado('cr-1', '  ')).rejects.toThrow(/versión/)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('el error de la base se propaga para que la pantalla lo muestre', async () => {
    const error = { code: '42501', message: 'x' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(marcarContrarreembolsoCobrado('cr-1', '2026-12-01T10:00:00+00:00')).rejects.toBe(error)
  })

  it('los códigos de la base se traducen a castellano sin filtrar el detalle crudo', () => {
    expect(mensajeDeErrorContrarreembolso({ code: '40001' }, 'x')).toContain('Otra persona modificó')
    expect(mensajeDeErrorContrarreembolso({ code: '42501' }, 'x')).toContain('no puede cobrar')
    expect(mensajeDeErrorContrarreembolso({ code: '55000' }, 'x')).toContain('anulada')
    expect(mensajeDeErrorContrarreembolso({ code: 'P0002' }, 'x')).toContain('no pertenece a tu organización')
    expect(mensajeDeErrorContrarreembolso({ code: '22023', message: 'El transporte no cobra' }, 'x')).toBe('El transporte no cobra')
    expect(mensajeDeErrorContrarreembolso({ code: 'XX000' }, 'No pudimos cobrar')).toBe('No pudimos cobrar')
  })
})

// Respuesta por defecto de las RPC de la pantalla: una fila pendiente, un resumen y permiso de
// cobro en la tienda. Cada prueba puede reescribir la que necesita.
const rpcPorDefecto = (filas: Contrarreembolso[] = [fila()], total = filas.length) =>
  vi.fn(async (nombre: string) => {
    switch (nombre) {
      case 'listar_contrarreembolsos':
        return { data: filas.map((f) => ({ ...f, importe: String(f.importe), filas: total })), error: null }
      case 'resumen_contrarreembolsos':
        return { data: [{ pendiente_importe: '1000', pendiente_cantidad: '1', cobrado_mes_importe: '500' }], error: null }
      case 'puede_cobrar_contrarreembolso':
        return { data: true, error: null }
      case 'marcar_contrarreembolso_cobrado':
        // La RPC devuelve la fila de `dominio.contrarreembolsos` (no la del listado).
        return {
          data: {
            id: filas[0]?.id ?? 'cr-1',
            organizacion_id: 'org-1',
            empresa_id: filas[0]?.empresa_id ?? 'e-1',
            comprobante_id: filas[0]?.comprobante_id ?? 'f-1',
            transporte_id: filas[0]?.transporte_id ?? 't-1',
            guia: filas[0]?.guia ?? 'G-0001',
            importe: '1000',
            estado: 'cobrado',
            cobrado_por: 'd-2',
            cobrado_por_nombre: 'Administración',
            cobrado_en: '2026-12-02T10:00:00+00:00',
            cobro_id: 'cobro-1',
            creado_en: filas[0]?.fecha ?? '2026-12-01T10:00:00+00:00',
            actualizado_en: '2026-12-02T10:00:00+00:00',
          },
          error: null,
        }
      default:
        return { data: [], error: null }
    }
  })

describe('Transportes y contrarreembolsos (FR-046)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    // Las tiendas del filtro son las accesibles y la activa es la de la barra superior
    // (Principio VIII): el filtro de la pantalla la sigue.
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [
        { id: 'e-1', nombre: 'San Javucho', esActiva: true },
        { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
      ],
      empresaActivaId: 'e-1',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mocks.rpc.mockImplementation(rpcPorDefecto())
    mocks.listarTransportes.mockResolvedValue({
      transportes: [{
        id: 't-1', organizacion_id: 'org-1', nombre: 'Expreso Uno', tipo: 'expreso', cuit: null,
        terminal_retiro: 'Terminal Sur', localidad: 'Rosario', telefono: '0341 000-0000', correo: null,
        persona_contacto: null, direccion: null, cobra_contrarreembolso: true, comision_pct: 0,
        plazo_rendicion_dias: 0, orden: 0, activa: true, updated_at: '2026-12-01T10:00:00+00:00', empresas: [],
      }],
      total: 1,
      totalOrganizacion: 30,
    })
  })

  it('muestra el título, el subtítulo y el filtro Tienda del prototipo', () => {
    renderPantalla()
    expect(screen.getByRole('heading', { name: 'Transportes y contrarreembolsos' })).toBeInTheDocument()
    expect(
      screen.getByText('Cobros a la entrega por empresa de transporte, mensajería propia en moto y terminales de retiro.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Todas las tiendas' })).toBeInTheDocument()
    expect(
      screen.getByText('Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'),
    ).toBeInTheDocument()
  })

  it('arranca en la sub-pestaña «Contrarreembolsos» con su ayuda', () => {
    renderPantalla()
    const pestanas = screen.getAllByRole('tab')
    expect(pestanas.map((pestana) => pestana.textContent)).toEqual(['Contrarreembolsos', 'Terminales de retiro'])
    expect(pestanas[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('El transporte cobra al entregar y rinde después.')).toBeInTheDocument()
  })

  it('la sub-pestaña «Terminales de retiro» conserva la tabla de MSF-139', async () => {
    renderPantalla()
    fireEvent.click(screen.getByRole('tab', { name: 'Terminales de retiro' }))
    expect(await screen.findByText('Expreso Uno')).toBeInTheDocument()
    for (const nombre of ['Empresa de transporte', 'Terminal de retiro', 'Localidad', 'Teléfono', 'Contacto']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    // El diálogo y el botón de MSF-139 siguen igual.
    expect(screen.getByRole('button', { name: 'Nueva empresa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar Expreso Uno' })).toBeInTheDocument()
    expect(screen.getByText('1 de 30 empresas de transporte')).toBeInTheDocument()
    // Y la ayuda de la pestaña es la del prototipo.
    expect(screen.getByText('Empresas de transporte y dónde retira cada una.')).toBeInTheDocument()
  })

  it('el filtro Tienda pide esa tienda al servidor', async () => {
    renderPantalla()
    fireEvent.click(screen.getByRole('tab', { name: 'Terminales de retiro' }))
    await screen.findByText('Expreso Uno')
    // Por defecto pide la empresa activa de la barra superior (Principio VIII).
    expect(mocks.listarTransportes).toHaveBeenLastCalledWith({ empresaId: 'e-1', pagina: 1, tamano: 25 })
    // Y las píldoras la sobreescriben sin cambiar la activa.
    fireEvent.click(screen.getByRole('button', { name: 'Mundo JC' }))
    await waitFor(() =>
      expect(mocks.listarTransportes).toHaveBeenLastCalledWith({ empresaId: 'e-2', pagina: 1, tamano: 25 }),
    )
  })
})

describe('Contrarreembolsos: tarjetas y tabla (FR-045 y FR-047)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    // Las tiendas del filtro son las accesibles y la activa es la de la barra superior
    // (Principio VIII): el filtro de la pantalla la sigue.
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [
        { id: 'e-1', nombre: 'San Javucho', esActiva: true },
        { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
      ],
      empresaActivaId: 'e-1',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mocks.rpc.mockImplementation(rpcPorDefecto())
  })

  it('muestra las tarjetas «Contrarreembolsos pendientes» y «Cobrados este mes»', async () => {
    renderPantalla()
    const pendientes = await screen.findByRole('region', { name: 'Contrarreembolsos pendientes' })
    expect(within(pendientes).getByText('$ 1.000')).toBeInTheDocument()
    expect(within(pendientes).getByText('1 envío sin rendir')).toBeInTheDocument()
    const cobrados = screen.getByRole('region', { name: 'Cobrados este mes' })
    expect(within(cobrados).getByText('$ 500')).toBeInTheDocument()
    expect(within(cobrados).getByText('Rendidos por los transportes')).toBeInTheDocument()
  })

  it('muestra las columnas del prototipo con el chip de Estado', async () => {
    renderPantalla()
    const tabla = await screen.findByRole('table', { name: 'Contrarreembolsos' })
    expect(tabla).toBeInTheDocument()
    for (const nombre of ['Fecha', 'Tienda', 'Comprobante', 'Cliente', 'Empresa de transporte', 'Guía', 'Importe', 'Estado']) {
      expect(screen.getByRole('columnheader', { name: nombre })).toBeInTheDocument()
    }
    expect(within(tabla).getByText('01/12/2026')).toBeInTheDocument()
    expect(within(tabla).getByText('San Javucho')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '0001-00000001' })).toHaveAttribute('href', '/ventas/comprobantes/f-1')
    expect(within(tabla).getByText('Cliente Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('Expreso Uno')).toBeInTheDocument()
    expect(within(tabla).getByText('G-0001')).toBeInTheDocument()
    expect(within(tabla).getByText('$ 1.000')).toBeInTheDocument()
    expect(within(tabla).getByText('Pendiente')).toBeInTheDocument()
  })

  it('«Marcar cobrado» cobra el contrarreembolso, avisa y recarga', async () => {
    renderPantalla()
    const boton = await screen.findByRole('button', { name: 'Marcar cobrado · G-0001' })
    fireEvent.click(boton)

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('marcar_contrarreembolso_cobrado', {
      p_id: 'cr-1',
      p_actualizado_en: '2026-12-01T10:00:00+00:00',
    }))
    expect(await screen.findByText('Contrarreembolso cobrado · Expreso Uno')).toBeInTheDocument()
    // La lista y las tarjetas se recargan para reflejar el nuevo estado.
    await waitFor(() =>
      expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'listar_contrarreembolsos').length).toBeGreaterThan(1),
    )
  })

  it('un contrarreembolso ya cobrado muestra el botón deshabilitado', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto([fila({ estado: 'cobrado' })]))
    renderPantalla()
    const boton = await screen.findByRole('button', { name: 'Marcar cobrado · G-0001' })
    expect(boton).toBeDisabled()
    expect(screen.getByText('Cobrado')).toBeInTheDocument()
  })

  it('sin permiso en la tienda el botón «Marcar cobrado» no aparece', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'puede_cobrar_contrarreembolso') return { data: false, error: null }
      return rpcPorDefecto()(nombre)
    })
    renderPantalla()
    await screen.findByRole('table', { name: 'Contrarreembolsos' })
    expect(screen.queryByRole('button', { name: 'Marcar cobrado · G-0001' })).not.toBeInTheDocument()
    // Pero el listado se ve igual: es de lectura.
    expect(screen.getByText('G-0001')).toBeInTheDocument()
  })

  it('sin contrarreembolsos muestra el estado vacío', async () => {
    mocks.rpc.mockImplementation(rpcPorDefecto([]))
    renderPantalla()
    expect(await screen.findByText('Todavía no hay contrarreembolsos.')).toBeInTheDocument()
  })

  it('si la carga falla muestra el error y «Reintentar» vuelve a pedir', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'listar_contrarreembolsos') return { data: null, error: { code: 'XX000', message: 'caída' } }
      return rpcPorDefecto()(nombre)
    })
    renderPantalla()
    expect(await screen.findByText('No pudimos cargar los contrarreembolsos.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() =>
      expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'listar_contrarreembolsos').length).toBeGreaterThan(1),
    )
  })

  it('mientras carga muestra el estado de carga', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'listar_contrarreembolsos') {
        return new Promise((resuelve) => { resolver = resuelve })
      }
      return Promise.resolve(rpcPorDefecto()(nombre))
    })
    renderPantalla()
    expect(await screen.findByLabelText('Cargando contenido')).toBeInTheDocument()
    resolver({ data: [], error: null })
    await waitFor(() => expect(screen.queryByLabelText('Cargando contenido')).not.toBeInTheDocument())
  })

  it('las filas aparecen aunque la lectura del permiso de cobro se demore', async () => {
    // La lectura del permiso no bloquea la tabla: si esa llamada se cuelga, la persona ve los
    // contrarreembolsos igual (el botón «Marcar cobrado» aparece cuando la base conteste).
    mocks.rpc.mockImplementation((nombre: string) => {
      if (nombre === 'puede_cobrar_contrarreembolso') return new Promise(() => undefined)
      return rpcPorDefecto()(nombre)
    })
    renderPantalla()
    expect(await screen.findByRole('table', { name: 'Contrarreembolsos' })).toBeInTheDocument()
    expect(screen.getByText('G-0001')).toBeInTheDocument()
    // Sin el permiso todavía no se ofrece el botón (deny-by-default).
    expect(screen.queryByRole('button', { name: 'Marcar cobrado · G-0001' })).not.toBeInTheDocument()
  })

  it('el lector de pantalla anuncia cuántos contrarreembolsos hay (SC-006)', async () => {
    renderPantalla()
    await screen.findByRole('table', { name: 'Contrarreembolsos' })
    const anuncio = screen.getByRole('status')
    expect(anuncio).toHaveTextContent('1 contrarreembolso')
  })

  it('es operable con teclado y el lector de pantalla (SC-006)', async () => {
    renderPantalla()
    const tabla = await screen.findByRole('table', { name: 'Contrarreembolsos' })
    expect(tabla).toBeInTheDocument()
    // El panel de la pestaña está asociado a su pestaña.
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('aria-labelledby', 'transportes-tab-contrarreembolsos')
    // El botón de la fila se puede enfocar con el teclado.
    const boton = screen.getByRole('button', { name: 'Marcar cobrado · G-0001' })
    boton.focus()
    expect(boton).toHaveFocus()
    // Y la tabla se anuncia con su nombre y su encabezado de acciones.
    expect(within(tabla).getByRole('columnheader', { name: 'Acciones' })).toBeInTheDocument()
  })
})

describe('Contrarreembolsos: empresa activa y paginación (FR-048)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    // Las tiendas del filtro son las accesibles y la activa es la de la barra superior
    // (Principio VIII): el filtro de la pantalla la sigue.
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [
        { id: 'e-1', nombre: 'San Javucho', esActiva: true },
        { id: 'e-2', nombre: 'Mundo JC', esActiva: false },
      ],
      empresaActivaId: 'e-1',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    mocks.rpc.mockImplementation(rpcPorDefecto([fila()], 25))
  })

  it('al cambiar la empresa activa recarga todo y vuelve a la primera página', async () => {
    const { rerender } = renderPantalla()
    await screen.findByRole('table', { name: 'Contrarreembolsos' })

    // La pantalla pagina en el servidor: la página 2 se pide con pagina = 2.
    fireEvent.click(screen.getByRole('button', { name: /next page|siguiente/i }))
    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith('listar_contrarreembolsos', expect.objectContaining({ p_pagina: 2 })),
    )
    const pedidosAntesDelCambio = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'listar_contrarreembolsos').length

    // Cambia la empresa activa de la barra superior.
    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-2', nombre: 'Mundo JC', esActiva: true }],
      empresaActivaId: 'e-2',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    rerender(<MemoryRouter><TransporteList /></MemoryRouter>)

    // La paginación se reencuadra (vuelve a la primera) y se recarga el listado y las tarjetas.
    await waitFor(() => {
      const ultimoListado = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'listar_contrarreembolsos').at(-1)
      expect(ultimoListado?.[1]).toMatchObject({ p_pagina: 1 })
    })
    await waitFor(() =>
      expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'resumen_contrarreembolsos').length).toBeGreaterThan(1),
    )
    // Y la consulta nueva pide esa tienda: el listado y las tarjetas son de la empresa activa
    // (Principio VIII, FR-048), no de todas.
    const pedidosNuevos = mocks.rpc.mock.calls
      .filter(([nombre]) => nombre === 'listar_contrarreembolsos')
      .slice(pedidosAntesDelCambio)
    expect(pedidosNuevos.length).toBeGreaterThan(0)
    for (const [, argumentos] of pedidosNuevos) {
      expect(argumentos).toMatchObject({ p_empresa_id: 'e-2', p_pagina: 1 })
    }
    const resumenNuevo = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'resumen_contrarreembolsos').at(-1)
    expect(resumenNuevo?.[1]).toMatchObject({ p_empresa_id: 'e-2' })
  })

  it('mientras llega la respuesta de la tienda nueva no muestra las filas de la anterior', async () => {
    let resolver: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementation((nombre: string) => {
      // La primera respuesta (la de la tienda anterior) llega; la de la nueva se queda esperando.
      if (nombre === 'listar_contrarreembolsos' && mocks.rpc.mock.calls.filter(([n]) => n === 'listar_contrarreembolsos').length > 1) {
        return new Promise((resuelve) => { resolver = resuelve })
      }
      return Promise.resolve(rpcPorDefecto()(nombre))
    })
    const { rerender } = renderPantalla()
    await screen.findByRole('table', { name: 'Contrarreembolsos' })
    expect(screen.getByText('G-0001')).toBeInTheDocument()

    mocks.useEmpresasAccesibles.mockReturnValue({
      empresas: [{ id: 'e-2', nombre: 'Mundo JC', esActiva: true }],
      empresaActivaId: 'e-2',
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    rerender(<MemoryRouter><TransporteList /></MemoryRouter>)

    // La fila de la tienda anterior desaparece: en su lugar, el estado de carga.
    await waitFor(() => expect(screen.queryByText('G-0001')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Cargando contenido')).toBeInTheDocument()
    resolver({ data: [], error: null })
  })
})
