import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

// La lectura de alertas devuelve, además de las válidas, filas de tipos de Mercado Libre / precios en revisión
// que la base todavía no genera: la pantalla no las muestra (FR-027).
const filas = vi.hoisted(() => [
  { id: 'a1', empresa_id: null, tipo: 'sin_stock', cantidad: 2, calculada_en: new Date().toISOString() },
  { id: 'a2', empresa_id: null, tipo: 'precios_en_revision', cantidad: 5, calculada_en: new Date().toISOString() },
  { id: 'a3', empresa_id: null, tipo: 'mercado_libre_pausado', cantidad: 1, calculada_en: new Date().toISOString() },
])
vi.mock('../../../lib/supabase', () => ({
  supabaseClient: {
    from: () => {
      const consulta: Record<string, unknown> = {}
      consulta.select = () => consulta
      consulta.or = () => consulta
      consulta.limit = () => consulta
      consulta.then = (resolver: (valor: unknown) => unknown) => resolver({ data: filas, error: null })
      return consulta
    },
  },
}))
vi.mock('../../../hooks/useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))
vi.mock('../../../hooks/useEmpresasAccesibles', () => ({ useEmpresasAccesibles: () => ({ empresaActivaId: null, isLoading: false, empresas: [] }) }))

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
  it('Inicio no muestra tarjetas de Mercado Libre ni de precios en revisión mientras la funcionalidad no existe', async () => {
    render(<MemoryRouter><InicioPage /></MemoryRouter>)
    // Las alertas válidas sí se muestran; las de Mercado Libre / precios en revisión no (FR-027).
    expect(await screen.findByText('2 productos sin stock')).toBeInTheDocument()
    expect(screen.queryByText(/Mercado Libre/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/precios en revisión/i)).not.toBeInTheDocument()
  })
})
