import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import type { BorradorTienda } from '../../../lib/tiendaBorrador'

const mocks = vi.hoisted(() => ({
  obtener: vi.fn(),
  publicar: vi.fn(),
  descartar: vi.fn(),
  vista: vi.fn(),
  advertir: vi.fn(),
  versiones: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.advertir }) }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../../lib/tiendaDominio', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaDominio')>()),
  leerDominioTienda: vi.fn().mockResolvedValue({
    dominioVigente: 'mundojc.com.ar', dominioPendiente: null, redireccion: null, dominioVerificado: true,
    certificado: 'activo', ultimaVerificacion: null, registros: [],
  }),
}))
vi.mock('../../../lib/tiendaBorrador', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaBorrador')>()),
  obtenerBorrador: mocks.obtener,
  publicarTienda: mocks.publicar,
  descartarBorrador: mocks.descartar,
  leerVistaPrevia: mocks.vista,
  listarVersiones: mocks.versiones,
}))

import PestanaPublicacion from './pestanas/publicacion'

const SIN_CAMBIOS: BorradorTienda = {
  hayBorrador: false,
  identidad: null,
  contenido: null,
  catalogo: null,
  cambios: { total: 0, resumen: '', detalle: [] },
  versionVigente: { numero: 14, publicadaAt: '2027-02-01T15:30:00', publicadaPor: 'Ana Pérez' },
  enLinea: true,
  dominio: 'mundojc.com.ar',
}

const CON_CAMBIOS: BorradorTienda = {
  ...SIN_CAMBIOS,
  hayBorrador: true,
  cambios: {
    total: 3,
    resumen: 'colores, texto del banner y 2 productos visibles',
    detalle: [
      { area: 'identidad', campos: ['colores'] },
      { area: 'contenido', campos: ['texto del banner'] },
      { area: 'catalogo', campos: ['2 productos visibles'] },
    ],
  },
}

const VISTA = {
  empresaNombre: 'Mundo JC',
  enLinea: true,
  identidad: { color_primario: '#A3111D', color_acento: '#A3111D', color_fondo: '#FFFFFF', logo_ruta: null, banner_ruta: null },
  contenido: {},
  hayProductos: true,
  categorias: [],
  destacados: [
    { id: 'p1', nombre: 'Joystick', precio: 49.9, disponible: true, imagen: null, categoriaId: null },
    { id: 'p2', nombre: 'Cable', precio: null, disponible: true, imagen: null, categoriaId: null },
  ],
}

function pestana(empresaId = 'e-1', empresaNombre = 'Mundo JC') {
  return (
    <MemoryRouter>
      <PestanaPublicacion empresaId={empresaId} empresaNombre={empresaNombre} />
    </MemoryRouter>
  )
}

async function abrir(borrador: BorradorTienda = CON_CAMBIOS) {
  mocks.obtener.mockResolvedValue(borrador)
  const vista = render(pestana())
  await screen.findByRole('heading', { name: 'Publicación' })
  await screen.findByText(/Estado: /)
  return vista
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.publicar.mockResolvedValue(15)
  mocks.descartar.mockResolvedValue(undefined)
  mocks.vista.mockResolvedValue(VISTA)
  mocks.versiones.mockResolvedValue([])
})

describe('Publicación · estado y aviso de cambios (FR-053, FR-054, FR-055)', () => {
  it('muestra el estado, la versión vigente, el chip y el aviso con el resumen del servidor', async () => {
    await abrir()
    expect(screen.getByText('Estado: publicada')).toBeInTheDocument()
    expect(screen.getByText('En línea')).toBeInTheDocument()
    expect(screen.getByText(/Versión 14 · publicada el 01\/02\/2027 15:30 por Ana Pérez/)).toBeInTheDocument()
    expect(screen.getByText('3 cambios sin publicar: colores, texto del banner y 2 productos visibles.')).toBeInTheDocument()
    expect(screen.getByText('Hay cambios sin publicar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Guardar y publicar' })).toBeEnabled()
  })

  it('«Ver cambios» despliega el detalle por área, sin valores', async () => {
    await abrir()
    expect(screen.queryByText('Identidad visual')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver cambios' }))
    const lista = await screen.findByRole('list', { name: 'Cambios sin publicar por área' })
    expect(within(lista).getByText('Identidad visual')).toBeInTheDocument()
    expect(within(lista).getByText('colores')).toBeInTheDocument()
    expect(within(lista).getByText('Catálogo visible')).toBeInTheDocument()
    expect(within(lista).getByText('2 productos visibles')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver cambios' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('sin borrador: sin aviso y con «Descartar» y «Guardar y publicar» deshabilitados', async () => {
    await abrir(SIN_CAMBIOS)
    expect(screen.queryByText(/cambios? sin publicar:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ver cambios' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar y publicar' })).toBeDisabled()
  })

  it('«Fuera de línea» cuando la empresa está desactivada (FR-054)', async () => {
    await abrir({ ...SIN_CAMBIOS, enLinea: false })
    expect(screen.getByText('Estado: fuera de línea')).toBeInTheDocument()
    expect(screen.getByText('Fuera de línea')).toBeInTheDocument()
    expect(screen.getByText(/siguen viendo «Volvemos pronto»/)).toBeInTheDocument()
  })

  it('una tienda sin versiones lo dice', async () => {
    await abrir({ ...SIN_CAMBIOS, versionVigente: null })
    expect(screen.getByText('Todavía no hay versiones publicadas.')).toBeInTheDocument()
  })

  it('un error de carga ofrece reintentar', async () => {
    mocks.obtener.mockRejectedValueOnce(new Error('boom'))
    render(pestana())
    expect(await screen.findByText('No pudimos cargar el estado de la publicación.')).toBeInTheDocument()
    mocks.obtener.mockResolvedValue(SIN_CAMBIOS)
    fireEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0])
    expect(await screen.findByText('Estado: publicada')).toBeInTheDocument()
  })
})

describe('Publicación · diálogos (FR-056, FR-057, FR-065)', () => {
  it('«Guardar y publicar» abre «Publicar cambios» con el dominio; «Publicar» publica, avisa y relee', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Publicar cambios' })
    expect(within(dialogo).getByText('Los cambios se ven de inmediato en mundojc.com.ar. Podés volver a la versión anterior desde Dominio y publicación.')).toBeInTheDocument()

    mocks.obtener.mockResolvedValue({ ...SIN_CAMBIOS, versionVigente: { numero: 15, publicadaAt: '2027-02-02T10:00:00', publicadaPor: 'Ana Pérez' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Publicar' }))

    expect(await screen.findByText('Store publicada')).toBeInTheDocument()
    expect(mocks.publicar).toHaveBeenCalledWith('e-1')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/Versión 15 ·/)).toBeInTheDocument()
    expect(screen.queryByText(/cambios sin publicar:/)).not.toBeInTheDocument()
  })

  it('«Cancelar» no publica nada', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Publicar cambios' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.publicar).not.toHaveBeenCalled()
  })

  it('un fallo al publicar lo avisa en el diálogo y no confirma', async () => {
    mocks.publicar.mockRejectedValue(new Error('red'))
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Publicar cambios' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Publicar' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('No pudimos publicar los cambios')
    expect(screen.queryByText('Store publicada')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Publicar cambios' })).toBeInTheDocument()
  })

  it('«Descartar» abre «Descartar cambios»; «Descartar» borra el borrador y avisa', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Descartar cambios' })
    expect(within(dialogo).getByText('Se pierden los cambios sin publicar de esta store.')).toBeInTheDocument()

    mocks.obtener.mockResolvedValue(SIN_CAMBIOS)
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Descartar' }))
    expect(await screen.findByText('Cambios descartados')).toBeInTheDocument()
    expect(mocks.descartar).toHaveBeenCalledWith('e-1')
    expect(mocks.publicar).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar y publicar' })).toBeDisabled())
  })

  it('Principio VIII: el diálogo abierto se cierra con aviso al cambiar de empresa y no publica nada', async () => {
    const { rerender } = await abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    await screen.findByRole('dialog', { name: 'Publicar cambios' })

    mocks.obtener.mockResolvedValue({ ...SIN_CAMBIOS, dominio: 'sanjavucho.com.ar' })
    rerender(pestana('e-2', 'San Javucho'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Se cerró el diálogo porque cambió la empresa activa. No se aplicó nada.')).toBeInTheDocument()
    expect(mocks.publicar).not.toHaveBeenCalled()
    expect(mocks.obtener).toHaveBeenLastCalledWith('e-2')
    expect(screen.queryByText(/cambios sin publicar:/)).not.toBeInTheDocument()
  })

  it('sin diálogo abierto, cambiar de empresa no deja aviso', async () => {
    const { rerender } = await abrir()
    mocks.obtener.mockResolvedValue(SIN_CAMBIOS)
    rerender(pestana('e-2', 'San Javucho'))
    await waitFor(() => expect(mocks.obtener).toHaveBeenLastCalledWith('e-2'))
    expect(screen.queryByText(/Se cerró el diálogo/)).not.toBeInTheDocument()
  })
})

describe('Vista previa (tarjeta) · FR-059', () => {
  it('muestra tres productos de ejemplo de la vista previa del servidor y el texto de actualización', async () => {
    await abrir()
    const tarjeta = await screen.findByTestId('tarjeta-vista-previa')
    expect(within(tarjeta).getByText('Joystick')).toBeInTheDocument()
    expect(within(tarjeta).getByText('Cable')).toBeInTheDocument()
    expect(screen.getByText('Se actualiza con los cambios sin publicar.')).toBeInTheDocument()
    expect(mocks.vista).toHaveBeenCalledWith('e-1')
    expect(screen.getByRole('link', { name: 'Abrir vista previa' })).toHaveAttribute('href', '/empresas/e-1/tienda/vista-previa')
  })

  it('se relee tras publicar', async () => {
    await abrir()
    await screen.findByTestId('tarjeta-vista-previa')
    expect(mocks.vista).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Publicar cambios' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Publicar' }))
    await screen.findByText('Store publicada')
    await waitFor(() => expect(mocks.vista).toHaveBeenCalledTimes(2))
  })
})

describe('Publicación · accesibilidad (FR-066)', () => {
  it('no tiene violaciones de axe con cambios, con el diálogo abierto y sin borrador', async () => {
    const { container } = await abrir()
    await screen.findByTestId('tarjeta-vista-previa')
    expect(await violacionesAxe(container)).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Ver cambios' }))
    await screen.findByRole('list', { name: 'Cambios sin publicar por área' })
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Guardar y publicar' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Publicar cambios' })
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(await violacionesAxe(dialogo)).toEqual([])
  })

  it('sin borrador tampoco', async () => {
    const { container } = await abrir(SIN_CAMBIOS)
    await screen.findByTestId('tarjeta-vista-previa')
    expect(await violacionesAxe(container)).toEqual([])
  })
})
