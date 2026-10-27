import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-VTA-15 (MSF-152, SC-003): tarjeta «Responsables» del comprobante. Chip y texto de ayuda del estado de
// despacho, selectores de Armó/Controló/Entregó, acción del paso siguiente según el estado, error del servidor,
// rol en lectura (ve pero no avanza), doble clic y cambio de empresa activa (Principio VIII, FR-012).

const mocks = vi.hoisted(() => ({
  obtenerDespachoComprobante: vi.fn(),
  listarResponsablesDespacho: vi.fn(),
  cambiarEstadoDespacho: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: vi.fn() } }))
vi.mock('../../lib/ventasDespacho', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasDespacho')>()),
  obtenerDespachoComprobante: mocks.obtenerDespachoComprobante,
  listarResponsablesDespacho: mocks.listarResponsablesDespacho,
  cambiarEstadoDespacho: mocks.cambiarEstadoDespacho,
}))

import {
  MENSAJE_ERROR_CARGA_DESPACHO,
  MENSAJE_ERROR_DESPACHO,
  MENSAJE_EXITO_DESPACHO,
  MENSAJE_SIN_DESPACHO,
  PLACEHOLDER_RESPONSABLE,
} from '../../lib/ventasDespacho'
import type { DatosDespacho, EstadoDespacho } from '../../lib/ventasDespacho'
import { AVISO_CAMBIO_DE_TIENDA, ResponsablesDespacho } from './ResponsablesDespacho'

const DATOS: DatosDespacho = {
  estado_despacho: 'sin_armar',
  armo_id: null,
  armo: null,
  controlo_id: null,
  controlo: null,
  entrego_id: null,
  entrego: null,
  entregado_en: null,
  updated_at: '2026-10-24T10:00:00Z',
  puede_despachar: true,
}

const CANDIDATOS = [
  { user_id: 'u-1', nombre: 'Emilse Sosa', rol_id: 'deposito' },
  { user_id: 'u-2', nombre: 'Javier Paz', rol_id: 'administrador' },
]

const datos = (cambios: Partial<DatosDespacho> = {}): DatosDespacho => ({ ...DATOS, ...cambios })

const renderTarjeta = (props: Partial<ComponentProps<typeof ResponsablesDespacho>> = {}) => {
  const onCambio = vi.fn()
  const utils = render(
    <ResponsablesDespacho
      comprobanteId="k-1"
      empresaId="e-1"
      operador="Lucía Gómez"
      empresaActivaId="e-1"
      onCambio={onCambio}
      {...props}
    />,
  )
  return { ...utils, onCambio }
}

// El selector de MUI arma el nombre accesible con la etiqueta y el valor elegido («Armó Emilse Sosa»), así que
// se busca por el comienzo de la etiqueta.
const selector = (campo: 'Armó' | 'Controló' | 'Entregó') =>
  screen.getByRole('combobox', { name: new RegExp(`^${campo}`) })

const elegir = async (campo: 'Armó' | 'Controló' | 'Entregó', nombre: string) => {
  fireEvent.mouseDown(selector(campo))
  fireEvent.click(await screen.findByRole('option', { name: nombre }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  mocks.obtenerDespachoComprobante.mockResolvedValue(datos())
  mocks.listarResponsablesDespacho.mockResolvedValue(CANDIDATOS)
  mocks.cambiarEstadoDespacho.mockResolvedValue(undefined)
})

describe('Estado y responsables (FR-010)', () => {
  it('muestra el chip del estado con su texto de ayuda, el operador y los tres responsables con «Seleccionar»', async () => {
    renderTarjeta()
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
    expect(screen.getByText('La factura está confirmada y todavía no se armó.')).toBeInTheDocument()
    // El operador se muestra solo para lectura.
    expect(screen.getByLabelText('Operador')).toHaveValue('Lucía Gómez')
    expect(screen.getByLabelText('Operador')).toHaveAttribute('readonly')
    for (const campo of ['Armó', 'Controló', 'Entregó']) {
      expect(selector(campo as 'Armó')).toHaveTextContent(PLACEHOLDER_RESPONSABLE)
    }
  })

  it('ofrece los elegibles del paso siguiente y deja los otros campos en lectura', async () => {
    renderTarjeta()
    await screen.findByText('Sin armar')
    // Armando: el selector de «Armó» ofrece los elegibles de la tienda.
    await elegir('Armó', 'Emilse Sosa')
    expect(mocks.listarResponsablesDespacho).toHaveBeenCalledWith('e-1', 'armar')
    // Los otros dos pasos todavía no se firman: no hay lista ni campo editable.
    expect(selector('Controló')).toHaveAttribute('aria-disabled', 'true')
    expect(selector('Entregó')).toHaveAttribute('aria-disabled', 'true')
  })

  it('muestra el responsable ya registrado y lo deja en lectura', async () => {
    mocks.obtenerDespachoComprobante.mockResolvedValue(
      datos({ estado_despacho: 'armando', armo_id: 'u-1', armo: 'Emilse Sosa' }),
    )
    renderTarjeta()
    expect(await screen.findByText('Armando')).toBeInTheDocument()
    expect(selector('Armó')).toHaveTextContent('Emilse Sosa')
    expect(selector('Armó')).toHaveAttribute('aria-disabled', 'true')
    // El paso siguiente es el control.
    expect(mocks.listarResponsablesDespacho).toHaveBeenCalledWith('e-1', 'controlar')
  })
})

describe('Acciones por estado (FR-003, FR-010)', () => {
  const casos: ReadonlyArray<[EstadoDespacho, string]> = [
    ['sin_armar', 'Empezar a armar'],
    ['incompleto', 'Reanudar el armado'],
    ['armando', 'Controlar'],
    ['listo_para_despachar', 'Entregar'],
  ]

  it.each(casos)('en %s ofrece la acción «%s» con el responsable del paso', async (estado, etiqueta) => {
    mocks.obtenerDespachoComprobante.mockResolvedValue(datos({ estado_despacho: estado }))
    renderTarjeta()
    expect(await screen.findByRole('button', { name: etiqueta })).toBeInTheDocument()
  })

  it('en «entregado» no ofrece ninguna acción: es terminal', async () => {
    mocks.obtenerDespachoComprobante.mockResolvedValue(
      datos({ estado_despacho: 'entregado', entrego_id: 'u-2', entrego: 'Javier Paz', entregado_en: '2026-10-25T09:00:00Z' }),
    )
    renderTarjeta()
    expect(await screen.findByText('Entregado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /armar|Controlar|Entregar/i })).not.toBeInTheDocument()
  })

  it('avanza con el responsable elegido y avisa a la pantalla', async () => {
    renderTarjeta()
    await screen.findByText('Sin armar')
    await elegir('Armó', 'Emilse Sosa')
    fireEvent.click(screen.getByRole('button', { name: 'Empezar a armar' }))
    await waitFor(() => expect(mocks.cambiarEstadoDespacho).toHaveBeenCalledTimes(1))
    expect(mocks.cambiarEstadoDespacho).toHaveBeenCalledWith({
      id: 'k-1',
      estado: 'armando',
      responsableId: 'u-1',
      actualizadoEn: '2026-10-24T10:00:00Z',
    })
    expect(await screen.findByText(MENSAJE_EXITO_DESPACHO)).toBeInTheDocument()
  })

  it('el botón queda deshabilitado mientras no hay responsable elegido', async () => {
    renderTarjeta()
    expect(await screen.findByRole('button', { name: 'Empezar a armar' })).toBeDisabled()
  })
})

describe('Carga (FR-010, kit del panel)', () => {
  it('muestra el estado de carga del kit mientras llega el despacho', async () => {
    let resolver: ((valor: DatosDespacho) => void) | undefined
    mocks.obtenerDespachoComprobante.mockImplementation(
      () => new Promise<DatosDespacho>((resolve) => { resolver = resolve }),
    )
    renderTarjeta()
    // Mientras la RPC no responde, la tarjeta muestra la carga del kit (no un error).
    expect(await screen.findByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    resolver?.(datos())
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Cargando contenido' })).not.toBeInTheDocument()
  })
})

describe('Errores (FR-010, kit del panel)', () => {
  it('muestra el mensaje del servidor en castellano y no avanza nada', async () => {
    mocks.cambiarEstadoDespacho.mockRejectedValue({
      code: '55000',
      message: 'Una factura Sin armar no puede pasar a Entregado',
    })
    const { onCambio } = renderTarjeta()
    await screen.findByText('Sin armar')
    await elegir('Armó', 'Emilse Sosa')
    fireEvent.click(screen.getByRole('button', { name: 'Empezar a armar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Una factura Sin armar no puede pasar a Entregado')
    expect(onCambio).not.toHaveBeenCalled()
  })

  it('un error inesperado muestra un mensaje claro, sin datos técnicos', async () => {
    mocks.cambiarEstadoDespacho.mockRejectedValue({ code: 'XX000', message: 'relation dominio.x does not exist' })
    renderTarjeta()
    await screen.findByText('Sin armar')
    await elegir('Armó', 'Emilse Sosa')
    fireEvent.click(screen.getByRole('button', { name: 'Empezar a armar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_ERROR_DESPACHO)
    expect(screen.queryByText(/relation/)).not.toBeInTheDocument()
  })

  it('si no puede cargar el despacho, muestra el error con «Reintentar»', async () => {
    mocks.obtenerDespachoComprobante.mockRejectedValue(new Error('sin red'))
    renderTarjeta()
    expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_ERROR_CARGA_DESPACHO)
    const reintentar = screen.getByRole('button', { name: 'Reintentar' })
    mocks.obtenerDespachoComprobante.mockResolvedValue(datos())
    fireEvent.click(reintentar)
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
  })
})

describe('Solo lectura (FR-008, FR-010)', () => {
  it('un rol en lectura ve el estado y los responsables pero no puede avanzar', async () => {
    mocks.obtenerDespachoComprobante.mockResolvedValue(datos({ puede_despachar: false }))
    renderTarjeta()
    expect(await screen.findByText('Sin armar')).toBeInTheDocument()
    expect(screen.getByText(MENSAJE_SIN_DESPACHO)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Empezar a armar' })).not.toBeInTheDocument()
    expect(selector('Armó')).toHaveAttribute('aria-disabled', 'true')
    // No se piden los elegibles: sin permiso no hay a quién ofrecer.
    expect(mocks.listarResponsablesDespacho).not.toHaveBeenCalled()
  })
})

describe('Doble clic (FR-003)', () => {
  it('un doble clic no manda dos veces el cambio de estado', async () => {
    mocks.cambiarEstadoDespacho.mockImplementation(() => new Promise(() => undefined))
    renderTarjeta()
    await screen.findByText('Sin armar')
    await elegir('Armó', 'Emilse Sosa')
    const boton = screen.getByRole('button', { name: 'Empezar a armar' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await waitFor(() => expect(mocks.cambiarEstadoDespacho).toHaveBeenCalledTimes(1))
  })
})

describe('Cambio de empresa activa (FR-012, Principio VIII)', () => {
  it('suelta lo elegido, avisa y relee el despacho: no guarda bajo la otra tienda', async () => {
    const { rerender } = renderTarjeta()
    await screen.findByText('Sin armar')
    await elegir('Armó', 'Emilse Sosa')
    expect(selector('Armó')).toHaveTextContent('Emilse Sosa')

    rerender(
      <ResponsablesDespacho
        comprobanteId="k-1"
        empresaId="e-1"
        operador="Lucía Gómez"
        empresaActivaId="e-2"
        onCambio={vi.fn()}
      />,
    )

    expect(await screen.findByText(AVISO_CAMBIO_DE_TIENDA)).toBeInTheDocument()
    // Lo elegido se soltó: no queda un responsable de la tienda anterior.
    await waitFor(() => expect(selector('Armó')).toHaveTextContent(PLACEHOLDER_RESPONSABLE))
    expect(screen.getByRole('button', { name: 'Empezar a armar' })).toBeDisabled()
    // Y el despacho se volvió a leer.
    await waitFor(() => expect(mocks.obtenerDespachoComprobante).toHaveBeenCalledTimes(2))
    expect(mocks.cambiarEstadoDespacho).not.toHaveBeenCalled()
  })
})
