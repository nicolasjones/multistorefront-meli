import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  ingresarCliente: vi.fn(),
  salirCliente: vi.fn(),
  sesionActivaEnTienda: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('../../../lib/tiendaCuenta', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaCuenta')>()),
  ingresarCliente: mocks.ingresarCliente,
  salirCliente: mocks.salirCliente,
  sesionActivaEnTienda: mocks.sesionActivaEnTienda,
}))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: { auth: { onAuthStateChange: mocks.onAuthStateChange } } }))

import { AccesoCliente } from '../layout/AccesoCliente'
import RutaIngresar from './ingresar'

const contexto = { tienda: { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

function montar() {
  return render(
    <MemoryRouter initialEntries={['/ingresar']}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/ingresar" element={<RutaIngresar />} />
          <Route path="/" element={<p>Inicio de la tienda</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function completar(correo: string, contrasena: string) {
  fireEvent.change(screen.getByLabelText(/^Correo/), { target: { value: correo } })
  fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: contrasena } })
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))
}

describe('RutaIngresar (FR-020, FR-021)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ingresa con el host de la tienda y, con cuenta activa, vuelve al inicio', async () => {
    mocks.ingresarCliente.mockResolvedValue({ ok: true, tipo: 'minorista' })
    montar()
    completar('cli@example.com', 'Clave-12345!')
    expect(await screen.findByText('Inicio de la tienda')).toBeInTheDocument()
    expect(mocks.ingresarCliente).toHaveBeenCalledWith('mundojc.localhost', 'cli@example.com', 'Clave-12345!')
  })

  it('una cuenta no activa muestra el mensaje genérico, vacía la contraseña y no entra', async () => {
    mocks.ingresarCliente.mockResolvedValue({ ok: false, mensaje: 'Correo o contraseña incorrectos.' })
    montar()
    completar('cli@example.com', 'Clave-12345!')
    expect(await screen.findByText('Correo o contraseña incorrectos.')).toBeInTheDocument()
    expect(screen.queryByText('Inicio de la tienda')).not.toBeInTheDocument()
    expect((screen.getByLabelText(/^Contraseña/) as HTMLInputElement).value).toBe('')
  })

  it('ofrece recuperar la contraseña y no ofrece registrarse', () => {
    montar()
    expect(screen.getByRole('link', { name: '¿Olvidaste tu contraseña?' })).toHaveAttribute('href', '/recuperar-contrasena')
    expect(screen.queryByText(/registr|crear cuenta/i)).not.toBeInTheDocument()
  })

  it('no tiene violaciones de accesibilidad', async () => {
    const { container } = montar()
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('AccesoCliente · «Ingresar» / «Salir» del encabezado (FR-020)', () => {
  const unsubscribe = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } })
    mocks.salirCliente.mockResolvedValue(undefined)
  })

  const montarEncabezado = () => render(<MemoryRouter><AccesoCliente host="mundojc.localhost" /></MemoryRouter>)

  it('sin sesión muestra «Ingresar» con enlace a /ingresar', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue(null)
    montarEncabezado()
    expect(await screen.findByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/ingresar')
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })

  it('con cuenta activa muestra «Salir» y al pulsarlo cierra la sesión', async () => {
    mocks.sesionActivaEnTienda.mockResolvedValue({ estado: 'activa', tipo: 'minorista' })
    montarEncabezado()
    fireEvent.click(await screen.findByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.salirCliente).toHaveBeenCalledTimes(1))
  })

  it('mientras no se sabe el estado (error de red) no afirma ni «Ingresar» ni «Salir»', async () => {
    mocks.sesionActivaEnTienda.mockRejectedValue(new Error('red'))
    montarEncabezado()
    await waitFor(() => expect(mocks.sesionActivaEnTienda).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument()
  })
})
