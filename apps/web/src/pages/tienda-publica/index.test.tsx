import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ resolver: vi.fn(), redireccion: vi.fn(), categorias: vi.fn(), estado: vi.fn() }))

// El hook se prueba en lib/tiendaEstado.test.ts: acá se controla el estado que devuelve.
vi.mock('../../lib/tiendaEstado', () => ({ useEstadoTienda: mocks.estado }))

vi.mock('../../lib/tienda', () => ({
  resolverTienda: mocks.resolver,
  resolverRedireccion: mocks.redireccion,
  urlDeRedireccion: (principal: string) => `https://${principal}/`,
}))
vi.mock('../../lib/tiendaCategorias', () => ({ leerCategoriasPublicas: mocks.categorias }))

// La medición real se prueba en layout/MedicionTienda.test.tsx: acá solo importa si el front la monta.
vi.mock('./layout/MedicionTienda', () => ({ default: () => <div data-testid="medicion-montada" /> }))

import { TiendaPublicaApp } from './index'

describe('TiendaPublicaApp (FR-007, SC-004, SC-011)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.categorias.mockResolvedValue([])
    mocks.estado.mockReturnValue({ estado: { fase: 'desconocida' }, reintentar: vi.fn() })
    mocks.redireccion.mockResolvedValue(null)
  })

  it('muestra la tienda cuando el Host resuelve', async () => {
    mocks.resolver.mockResolvedValue({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(mocks.resolver).toHaveBeenCalledWith('mundojc.localhost')
  })

  it('muestra «Volvemos pronto» para un dominio desconocido o una tienda desactivada', async () => {
    mocks.resolver.mockResolvedValue(null)
    render(<TiendaPublicaApp host="no-existe.test" />)

    expect(await screen.findByRole('heading', { name: 'Volvemos pronto' })).toBeInTheDocument()
    expect(screen.getByTestId('volvemos-pronto-generica')).toBeInTheDocument()
    expect(mocks.estado).toHaveBeenCalledWith('no-existe.test')
  })

  it('para una tienda desactivada muestra «Volvemos pronto» con su marca (FR-002)', async () => {
    mocks.resolver.mockResolvedValue(null)
    mocks.estado.mockReturnValue({
      estado: {
        fase: 'pausada',
        marca: {
          nombre: 'Mundo JC', colorPrimario: '#AA1111', colorPrimarioOscuro: '#000000', colorAcento: '#222222', colorFondo: '#FFFFFF',
          tipografiaTitulos: 'system-ui', tipografiaTexto: 'system-ui', logoRuta: null,
        },
      },
      reintentar: vi.fn(),
    })
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(await screen.findByTestId('volvemos-pronto-marca')).toBeInTheDocument()
    expect(screen.getByText('Mundo JC')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Volvemos pronto' })).toBeInTheDocument()
  })

  it('si falla la consulta del estado ofrece reintentar y no lo disfraza de «Volvemos pronto» (FR-004)', async () => {
    mocks.resolver.mockResolvedValue(null)
    const reintentar = vi.fn()
    mocks.estado.mockReturnValue({ estado: { fase: 'error' }, reintentar })
    render(<TiendaPublicaApp host="no-existe.test" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar esta página.')
    expect(screen.queryByRole('heading', { name: 'Volvemos pronto' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(reintentar).toHaveBeenCalledTimes(1)
  })

  it('redirige al dominio principal cuando el host es el «Redirigir también» de una tienda (F-TDA-05, FR-013)', async () => {
    mocks.resolver.mockResolvedValue(null)
    mocks.redireccion.mockResolvedValue('mundojc.com.ar')
    const redirigir = vi.fn()
    render(<TiendaPublicaApp host="www.mundojc.com.ar" redirigir={redirigir} />)

    await waitFor(() => expect(redirigir).toHaveBeenCalledWith('https://mundojc.com.ar/'))
    expect(mocks.redireccion).toHaveBeenCalledWith('www.mundojc.com.ar')
    expect(screen.queryByRole('heading', { name: 'Volvemos pronto' })).not.toBeInTheDocument()
  })

  it('un host que resuelve una tienda no consulta la redirección', async () => {
    mocks.resolver.mockResolvedValue({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    render(<TiendaPublicaApp host="mundojc.com.ar" redirigir={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
    expect(mocks.redireccion).not.toHaveBeenCalled()
  })

  it('un error al consultar la redirección ofrece reintentar y no redirige', async () => {
    mocks.resolver.mockResolvedValue(null)
    mocks.redireccion.mockRejectedValueOnce(new Error('sin red'))
    const redirigir = vi.fn()
    render(<TiendaPublicaApp host="www.mundojc.com.ar" redirigir={redirigir} />)

    // La pantalla de error de la tienda (MSF-247, F-TDA-19) reemplazó al texto viejo «No pudimos cargar la tienda.».
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar esta página.')
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(redirigir).not.toHaveBeenCalled()
  })

  it('ante un error de red ofrece reintentar y no lo disfraza de «Volvemos pronto»', async () => {
    mocks.resolver.mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar esta página.')
    expect(screen.queryByRole('heading', { name: 'Volvemos pronto' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()
  })

  it('muestra el estado de carga mientras resuelve', () => {
    mocks.resolver.mockReturnValue(new Promise(() => {}))
    render(<TiendaPublicaApp host="mundojc.localhost" />)

    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
  })

  it('no muestra nada de la tienda anterior al cambiar de Host', async () => {
    mocks.resolver.mockResolvedValueOnce({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
    const { rerender } = render(<TiendaPublicaApp host="mundojc.localhost" />)
    expect(await screen.findByRole('heading', { name: 'Mundo JC' })).toBeInTheDocument()

    mocks.resolver.mockResolvedValueOnce({ tiendaId: 't-2', empresaNombre: 'San Javucho', estado: 'publicada' })
    rerender(<TiendaPublicaApp host="sanjavucho.localhost" />)

    expect(await screen.findByRole('heading', { name: 'San Javucho' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Mundo JC' })).not.toBeInTheDocument())
  })

  // Tienda «pausada» = empresa desactivada (MSF-149 / F-TDA-19): `resolverTienda` devuelve null y se muestra
  // «Volvemos pronto». El layout (donde vive la medición) no se monta: no se consultan IDs ni se carga ningún script
  // de Google o Meta (CA US2.4, SC-006).
  describe('la medición solo se monta en la tienda publicada (CA US2.4, SC-006)', () => {
    it('una tienda publicada monta la medición', async () => {
      mocks.resolver.mockResolvedValue({ tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' })
      render(<TiendaPublicaApp host="mundojc.localhost" />)
      expect(await screen.findByTestId('medicion-montada')).toBeInTheDocument()
    })

    it('una tienda pausada («Volvemos pronto» con su marca) no monta la medición', async () => {
      mocks.resolver.mockResolvedValue(null)
      mocks.estado.mockReturnValue({
        estado: {
          fase: 'pausada',
          marca: {
            nombre: 'Mundo JC', colorPrimario: '#AA1111', colorPrimarioOscuro: '#000000', colorAcento: '#222222', colorFondo: '#FFFFFF',
            tipografiaTitulos: 'system-ui', tipografiaTexto: 'system-ui', logoRuta: null,
          },
        },
        reintentar: vi.fn(),
      })
      render(<TiendaPublicaApp host="mundojc.localhost" />)
      expect(await screen.findByTestId('volvemos-pronto-marca')).toBeInTheDocument()
      expect(screen.queryByTestId('medicion-montada')).not.toBeInTheDocument()
      expect(document.head.querySelectorAll('script[src*="googletagmanager"], script[src*="facebook"]')).toHaveLength(0)
    })

    it('un dominio desconocido tampoco monta la medición', async () => {
      mocks.resolver.mockResolvedValue(null)
      render(<TiendaPublicaApp host="no-existe.test" />)
      expect(await screen.findByTestId('volvemos-pronto-generica')).toBeInTheDocument()
      expect(screen.queryByTestId('medicion-montada')).not.toBeInTheDocument()
    })
  })
})
