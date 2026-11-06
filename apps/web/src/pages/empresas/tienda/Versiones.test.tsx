import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import type { BorradorTienda, VersionTienda } from '../../../lib/tiendaBorrador'

const mocks = vi.hoisted(() => ({
  versiones: vi.fn(),
  restaurar: vi.fn(),
  obtener: vi.fn(),
}))

vi.mock('../../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../../lib/tiendaBorrador', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaBorrador')>()),
  listarVersiones: mocks.versiones,
  restaurarVersion: mocks.restaurar,
  obtenerBorrador: mocks.obtener,
}))

import Versiones from './pestanas/publicacion/Versiones'
import { EVENTO_PUBLICACION } from './pestanas/publicacion/Publicacion'

const VERSIONES: VersionTienda[] = [
  { numero: 14, publicadaAt: '2027-02-01T15:30:00', publicadaPor: 'Ana Pérez', resumen: 'banner móvil', vigente: true },
  { numero: 13, publicadaAt: '2027-01-20T11:40:00', publicadaPor: 'Emilse', resumen: 'categorías visibles', vigente: false },
  { numero: 12, publicadaAt: '2027-01-12T09:15:00', publicadaPor: null, resumen: 'Configuración inicial', vigente: false },
]

const SIN_BORRADOR: BorradorTienda = {
  hayBorrador: false, identidad: null, contenido: null, catalogo: null,
  cambios: { total: 0, resumen: '', detalle: [] },
  versionVigente: { numero: 14, publicadaAt: '2027-02-01T15:30:00', publicadaPor: 'Ana Pérez' },
  enLinea: true, dominio: 'mundojc.com.ar',
}
const CON_BORRADOR: BorradorTienda = {
  ...SIN_BORRADOR,
  hayBorrador: true,
  cambios: { total: 1, resumen: 'colores', detalle: [{ area: 'identidad', campos: ['colores'] }] },
}

function seccion(empresaId = 'e-1') {
  return (
    <MemoryRouter>
      <Versiones empresaId={empresaId} empresaNombre="Mundo JC" />
    </MemoryRouter>
  )
}

async function abrir(borrador: BorradorTienda = SIN_BORRADOR) {
  mocks.obtener.mockResolvedValue(borrador)
  const vista = render(seccion())
  await screen.findByRole('table', { name: 'Versiones publicadas' })
  return vista
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.versiones.mockResolvedValue(VERSIONES)
  mocks.restaurar.mockResolvedValue(undefined)
})

describe('Versiones · tabla (FR-071, FR-077)', () => {
  it('lista versión, fecha, autor y cambios, la más nueva primero', async () => {
    await abrir()
    expect(mocks.versiones).toHaveBeenCalledWith('e-1')
    for (const columna of ['Versión', 'Fecha', 'Por', 'Cambios']) {
      expect(screen.getByRole('columnheader', { name: columna })).toBeInTheDocument()
    }
    const filas = screen.getAllByRole('row').slice(1)
    expect(filas).toHaveLength(3)
    expect(within(filas[0]).getByText('14')).toBeInTheDocument()
    expect(within(filas[0]).getByText('01/02/2027 15:30')).toBeInTheDocument()
    expect(within(filas[0]).getByText('Ana Pérez')).toBeInTheDocument()
    expect(within(filas[0]).getByText('banner móvil')).toBeInTheDocument()
    expect(within(filas[2]).getByText('—')).toBeInTheDocument()
  })

  it('«Restaurar» está en todas las versiones menos la vigente', async () => {
    await abrir()
    expect(screen.getAllByRole('button', { name: /^Restaurar versión/ })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Restaurar versión 14' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restaurar versión 13' })).toBeInTheDocument()
  })

  it('sin versiones muestra el estado vacío', async () => {
    mocks.versiones.mockResolvedValue([])
    mocks.obtener.mockResolvedValue(SIN_BORRADOR)
    render(seccion())
    expect(await screen.findByText('Todavía no hay versiones')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('un error de carga ofrece reintentar', async () => {
    mocks.versiones.mockRejectedValueOnce(new Error('boom'))
    mocks.obtener.mockResolvedValue(SIN_BORRADOR)
    render(seccion())
    expect(await screen.findByText('No pudimos cargar las versiones.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table', { name: 'Versiones publicadas' })).toBeInTheDocument()
  })

  it('se relee cuando se publica o descarta desde otra sección', async () => {
    await abrir()
    expect(mocks.versiones).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new CustomEvent(EVENTO_PUBLICACION, { detail: { empresaId: 'e-1' } }))
    await waitFor(() => expect(mocks.versiones).toHaveBeenCalledTimes(2))
  })
})

describe('Restaurar versión · diálogo (FR-072)', () => {
  it('sin borrador, el diálogo no avisa de reemplazo', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    expect(within(dialogo).getByText('La versión elegida se carga como borrador. No se publica hasta que la confirmes.')).toBeInTheDocument()
    expect(within(dialogo).queryByText(/se reemplazan/)).not.toBeInTheDocument()
  })

  it('con borrador, avisa que se reemplazan los cambios sin publicar', async () => {
    await abrir(CON_BORRADOR)
    await waitFor(() => expect(mocks.obtener).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    expect(await within(dialogo).findByText('Los cambios sin publicar que hay ahora se reemplazan.')).toBeInTheDocument()
  })

  it('confirmar restaura, muestra el mensaje y avisa a las demás secciones', async () => {
    await abrir()
    const escuchador = vi.fn()
    window.addEventListener(EVENTO_PUBLICACION, escuchador)
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Restaurar' }))
    expect(await screen.findByText('Versión restaurada como borrador')).toBeInTheDocument()
    expect(mocks.restaurar).toHaveBeenCalledWith('e-1', 13)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(escuchador).toHaveBeenCalledTimes(1)
    window.removeEventListener(EVENTO_PUBLICACION, escuchador)
  })

  it('cancelar no restaura nada', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.restaurar).not.toHaveBeenCalled()
  })

  it('si falla, el diálogo queda abierto con el error y sin mensaje de éxito', async () => {
    mocks.restaurar.mockRejectedValueOnce(new Error('boom'))
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Restaurar' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos restaurar la versión')
    expect(screen.queryByText('Versión restaurada como borrador')).not.toBeInTheDocument()
  })
})

describe('Principio VIII · cambio de empresa (FR-076)', () => {
  it('el diálogo abierto se cierra con aviso y no restaura nada', async () => {
    const { rerender } = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    await screen.findByRole('dialog', { name: 'Restaurar versión' })

    mocks.versiones.mockResolvedValue([{ ...VERSIONES[0], numero: 2, resumen: 'otra tienda' }])
    rerender(seccion('e-2'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Se cerró el diálogo porque cambió la empresa activa. No se restauró nada.')).toBeInTheDocument()
    expect(mocks.restaurar).not.toHaveBeenCalled()
    expect(mocks.versiones).toHaveBeenLastCalledWith('e-2')
    expect(await screen.findByText('otra tienda')).toBeInTheDocument()
    expect(screen.queryByText('categorías visibles')).not.toBeInTheDocument()
  })

  it('sin diálogo abierto, cambiar de empresa no deja aviso', async () => {
    const { rerender } = await abrir()
    rerender(seccion('e-2'))
    await waitFor(() => expect(mocks.versiones).toHaveBeenLastCalledWith('e-2'))
    expect(screen.queryByText(/Se cerró el diálogo/)).not.toBeInTheDocument()
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px (SC-013)', (ancho) => {
  it('no tiene violaciones de axe con la tabla y con el diálogo', async () => {
    window.innerWidth = ancho
    const { container } = await abrir(CON_BORRADOR)
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar versión 13' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Restaurar versión' })
    expect(await violacionesAxe(dialogo)).toEqual([])
  })

  it('no tiene violaciones de axe en vacío y en error', async () => {
    window.innerWidth = ancho
    mocks.obtener.mockResolvedValue(SIN_BORRADOR)
    mocks.versiones.mockResolvedValueOnce([])
    const vacio = render(seccion())
    await screen.findByText('Todavía no hay versiones')
    expect(await violacionesAxe(vacio.container)).toEqual([])
    vacio.unmount()
    mocks.versiones.mockRejectedValueOnce(new Error('boom'))
    const error = render(seccion())
    await screen.findByText('No pudimos cargar las versiones.')
    expect(await violacionesAxe(error.container)).toEqual([])
  })
})
