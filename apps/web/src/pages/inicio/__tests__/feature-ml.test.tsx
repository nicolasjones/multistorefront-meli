import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: () => ({ nivel: 'edicion', isLoading: false }) }))
vi.mock('../../../context/PermisosPanel', () => ({ usePermisosPanel: () => ({ permisos: [], isLoading: false, recargar: () => {} }) }))
vi.mock('../useNombrePerfil', () => ({ useNombrePerfil: () => 'Ada' }))
vi.mock('../TarjetaEmpresas', () => ({ TarjetaEmpresas: () => <div>empresas</div> }))
vi.mock('../TarjetaStock', () => ({ TarjetaStock: () => <div>stock</div> }))
vi.mock('../TarjetaConsultas', () => ({ TarjetaConsultas: () => <div>consultas</div> }))
vi.mock('../TarjetaDolar', () => ({ TarjetaDolar: () => <div>dolar</div> }))
vi.mock('../AccesosDirectos', () => ({ AccesosDirectos: () => null }))

import { InicioPage } from '..'

describe('Mercado Libre y precios en revisión (FR-009)', () => {
  it('Inicio no muestra tarjetas de Mercado Libre ni de precios en revisión mientras la funcionalidad no existe', () => {
    render(<MemoryRouter><InicioPage /></MemoryRouter>)
    expect(screen.queryByText(/Mercado Libre/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/precios en revisión/i)).not.toBeInTheDocument()
  })
})
