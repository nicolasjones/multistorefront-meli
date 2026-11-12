import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../../test/axe'
import { ProveedorFuenteTienda, type FuenteTienda } from '../../../../lib/fuenteTienda'

const mocks = vi.hoisted(() => ({ leer: vi.fn() }))
vi.mock('../../../../lib/tiendaContacto', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../lib/tiendaContacto')>()), leerContactoTienda: mocks.leer }))

import ConsultasInicio, { orden } from '../../secciones/ConsultasInicio'

const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const montar = (fuente: FuenteTienda | null = null) =>
  render(<MemoryRouter><ProveedorFuenteTienda value={fuente}><ConsultasInicio tienda={tienda} host="mundojc.localhost" /></ProveedorFuenteTienda></MemoryRouter>)

// MSF-841: bloque «Consultas por WhatsApp / Escribinos» del final de la portada (MJC_Home, SJ_Home).
describe('ConsultasInicio', () => {
  beforeEach(() => vi.clearAllMocks())

  it('va después de los destacados y antes del pie', () => {
    expect(orden).toBeGreaterThan(100)
    expect(orden).toBeLessThan(900)
  })

  it('muestra WhatsApp (enlace wa.me) y «Escribinos» (a /contacto, con el correo)', async () => {
    mocks.leer.mockResolvedValue({ nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'mundojc377@gmail.com', horarios: null })
    const { container } = montar()
    const bloque = await screen.findByTestId('consultas-inicio')
    const whatsapp = within(bloque).getByRole('link', { name: /Consultas por WhatsApp/ })
    expect(whatsapp).toHaveAttribute('href', 'https://wa.me/5491173652596')
    expect(whatsapp).toHaveTextContent('+54 9 11 7365-2596')
    const escribinos = within(bloque).getByRole('link', { name: /Escribinos/ })
    expect(escribinos).toHaveAttribute('href', '/contacto')
    expect(escribinos).toHaveTextContent('mundojc377@gmail.com')
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('sin WhatsApp queda solo «Escribinos»', async () => {
    mocks.leer.mockResolvedValue({ nombre: 'Mundo JC', whatsapp: null, correo: null, horarios: null })
    montar()
    const bloque = await screen.findByTestId('consultas-inicio')
    expect(within(bloque).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/contacto'])
  })

  it('si el contacto no se puede leer, la portada conserva «Escribinos»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.leer.mockRejectedValue(new Error('caído'))
    montar()
    const bloque = await screen.findByTestId('consultas-inicio')
    expect(within(bloque).getAllByRole('link')).toHaveLength(1)
  })

  it('en la vista previa del panel no se dibuja ni se lee el contacto público', async () => {
    const { container } = montar({ identidad: {}, contenido: {}, inicio: {}, categorias: [] } as unknown as FuenteTienda)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(mocks.leer).not.toHaveBeenCalled()
  })
})
