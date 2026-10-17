import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  useIsSuperadmin: vi.fn(),
}))

vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: mocks.useIsSuperadmin }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { functions: { invoke: mocks.invoke } } }))
vi.mock('@refinedev/mui', () => ({
  Create: ({ children, isLoading }: { children: React.ReactNode; isLoading?: boolean }) => (
    <div aria-busy={isLoading ? 'true' : 'false'}>{children}</div>
  ),
}))

import { OrganizacionCreate } from './create'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/organizaciones/create']}>
      <Routes>
        <Route path="/organizaciones/create" element={<OrganizacionCreate />} />
        <Route path="/organizaciones" element={<p>Listado de organizaciones</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

function completarYEnviar() {
  fireEvent.change(screen.getByLabelText(/^Nombre de la organización/), { target: { value: 'Acme' } })
  fireEvent.change(screen.getByLabelText(/^Email del fundador/), { target: { value: 'fundador@example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Crear e invitar' }))
}

describe('OrganizacionCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: true, isLoading: false })
    mocks.invoke.mockResolvedValue({ data: {}, error: null })
  })

  it('un usuario que no es superadmin ve el aviso y no el formulario', () => {
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: false, isLoading: false })
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('solo para el superadmin')
    expect(screen.queryByRole('button', { name: 'Crear e invitar' })).not.toBeInTheDocument()
  })

  it('no muestra nada mientras verifica si es superadmin', () => {
    mocks.useIsSuperadmin.mockReturnValue({ isSuperadmin: null, isLoading: true })
    const { container } = renderPage()

    expect(container).toBeEmptyDOMElement()
  })

  it('el superadmin da de alta la organización y vuelve al listado', async () => {
    renderPage()
    completarYEnviar()

    expect(await screen.findByText('Listado de organizaciones')).toBeInTheDocument()
    expect(mocks.invoke).toHaveBeenCalledWith('crear-organizacion', {
      body: { nombre: 'Acme', email_fundador: 'fundador@example.com' },
    })
  })

  it('mientras se crea deshabilita el botón y muestra el estado de carga', async () => {
    mocks.invoke.mockReturnValue(new Promise(() => {}))
    renderPage()
    completarYEnviar()

    const boton = await screen.findByRole('button', { name: 'Creando…' })
    expect(boton).toBeDisabled()
  })

  it('muestra el motivo que devuelve la función cuando la invitación falla y permanece en el formulario', async () => {
    const respuesta = new Response(JSON.stringify({ error: 'fundador@example.com ya tiene una cuenta registrada' }), { status: 400 })
    mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(respuesta) })
    renderPage()
    completarYEnviar()

    expect(await screen.findByRole('alert')).toHaveTextContent('ya tiene una cuenta registrada')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear e invitar' })).toBeEnabled())
    expect(screen.queryByText('Listado de organizaciones')).not.toBeInTheDocument()
  })

  it('muestra el mensaje genérico si el error no es una respuesta HTTP de la función', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') })
    renderPage()
    completarYEnviar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
  })
})
