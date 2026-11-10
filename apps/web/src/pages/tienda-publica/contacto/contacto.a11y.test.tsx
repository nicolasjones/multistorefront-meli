import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({ leer: vi.fn(), enviar: vi.fn() }))

vi.mock('../../../lib/tiendaContacto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/tiendaContacto')>()),
  leerContactoTienda: mocks.leer,
  enviarConsultaContacto: mocks.enviar,
}))
vi.mock('../../../hooks/useContenidoPublico', () => ({ useContenidoPublico: () => null }))

import RutaContacto from '../rutas/contacto'

const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

function montar() {
  return render(
    <MemoryRouter initialEntries={['/contacto']}>
      <Routes>
        <Route element={<Outlet context={contexto} />}><Route path="/contacto" element={<RutaContacto />} /></Route>
      </Routes>
    </MemoryRouter>,
  )
}

// F-TDA-16 (FR-015, SC-003): axe a 320 / 768 / 1440 px en los estados del formulario.
describe.each([320, 768, 1440])('accesibilidad de /contacto a %i px', (ancho) => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.innerWidth = ancho
    mocks.leer.mockResolvedValue({ nombre: 'Mundo JC', whatsapp: '+54 9 11 7365-2596', correo: 'mundojc377@gmail.com', horarios: 'Lunes a viernes de 10 a 19 h' })
    mocks.enviar.mockResolvedValue({ estado: 'exito' })
  })

  it('la página, con errores por campo y con la confirmación, no tiene violaciones de axe', async () => {
    const { container } = montar()
    await screen.findByRole('heading', { name: 'Escribinos' })
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    expect(await screen.findAllByText(/Escribí tu|Dejanos un/)).not.toHaveLength(0)
    expect(screen.getByLabelText(/^Nombre/)).toHaveFocus()
    expect(await violacionesAxe(container)).toEqual([])

    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByLabelText(/^Correo o WhatsApp/), { target: { value: 'ana@ejemplo.com' } })
    fireEvent.change(screen.getByLabelText(/^Mensaje/), { target: { value: 'Hola' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar consulta' }))
    const gracias = await screen.findByRole('heading', { name: '¡Gracias! Recibimos tu consulta' })
    expect(gracias).toHaveFocus()
    expect(await violacionesAxe(container)).toEqual([])
  })
})
