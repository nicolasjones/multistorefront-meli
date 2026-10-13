import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const permiso = vi.hoisted(() => ({ valor: { puedeEscribir: false, isLoading: false } }))
vi.mock('../../hooks/usePuedeGestionarMembresias', () => ({ usePuedeGestionarMembresias: () => permiso.valor }))
vi.mock('../../components/usuarios/DialogoInvitarUsuario', () => ({
  DialogoInvitarUsuario: () => <div>Formulario de invitación</div>,
}))

import { MiembroCreate } from './create'

function renderRuta() {
  return render(
    <MemoryRouter initialEntries={['/miembros/create']}>
      <Routes>
        <Route path="/miembros/create" element={<MiembroCreate />} />
        <Route path="/miembros" element={<div>Listado de miembros</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MiembroCreate (ruta heredada)', () => {
  beforeEach(() => { permiso.valor = { puedeEscribir: false, isLoading: false } })

  it('redirige al listado a quien no puede gestionar usuarios, sin mostrar el formulario', () => {
    renderRuta()
    expect(screen.getByText('Listado de miembros')).toBeInTheDocument()
    expect(screen.queryByText('Formulario de invitación')).not.toBeInTheDocument()
  })

  it('muestra el formulario a quien puede gestionar usuarios', () => {
    permiso.valor = { puedeEscribir: true, isLoading: false }
    renderRuta()
    expect(screen.getByText('Formulario de invitación')).toBeInTheDocument()
  })

  it('espera la verificación de permisos antes de decidir', () => {
    permiso.valor = { puedeEscribir: false, isLoading: true }
    renderRuta()
    expect(screen.queryByText('Listado de miembros')).not.toBeInTheDocument()
    expect(screen.queryByText('Formulario de invitación')).not.toBeInTheDocument()
  })
})
