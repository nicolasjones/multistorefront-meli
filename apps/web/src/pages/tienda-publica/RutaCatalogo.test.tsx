import { render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import RutaCatalogo from './rutas/catalogo'
import type { ModuloSeccionCatalogo } from './seccionesCatalogo'

// F-TDA-12 (FR-035, FR-040): `/catalogo` con título, migas y el listado registrado en secciones-catalogo/.
const tienda = { tiendaId: 't-1', empresaNombre: 'Mundo JC', estado: 'publicada' }
const contexto = { tienda, host: 'mundojc.localhost', categorias: { fase: 'lista', categorias: [], reintentar: () => undefined } }

const modulos: Record<string, ModuloSeccionCatalogo> = {
  './secciones-catalogo/Falso.tsx': {
    default: ({ host, categoriaId }) => <p data-testid="listado">{host}|{String(categoriaId)}</p>,
  },
}

function montar(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <Routes>
        <Route element={<Outlet context={contexto} />}>
          <Route path="/catalogo" element={<RutaCatalogo modulos={modulos} />} />
          <Route path="/catalogo/:catalogoId" element={<RutaCatalogo modulos={modulos} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RutaCatalogo', () => {
  it('muestra el título, las migas y el listado sin categoría fija', () => {
    montar('/catalogo?stock=1')
    expect(screen.getByRole('heading', { level: 1, name: 'Todos los productos' })).toBeInTheDocument()
    const migas = screen.getByRole('navigation', { name: 'Migas de pan' })
    expect(migas).toHaveTextContent('Inicio')
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(screen.getByText('Todos los productos', { selector: 'p' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('listado')).toHaveTextContent('mundojc.localhost|null')
  })

  // F-TDA-15 (FR-025): con `?q=` es la página de resultados.
  it('con q: título «Resultados para “…”» y migas «Inicio / Resultados»', () => {
    montar('/catalogo?q=cargdor')
    expect(screen.getByRole('heading', { level: 1, name: 'Resultados para “cargdor”' })).toBeInTheDocument()
    expect(screen.getByText('Resultados', { selector: 'p' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Inicio' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Todos los productos')).not.toBeInTheDocument()
  })

  it('con q el texto se escapa y se normaliza', () => {
    montar(`/catalogo?q=${encodeURIComponent('  <b>carg</b>   dor ')}`)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Resultados para “<b>carg</b> dor”')
    expect(document.querySelector('h1 b')).toBeNull()
  })

  it('/catalogo/<algo> da la 404 amable', () => {
    montar('/catalogo/loquesea')
    expect(screen.getByTestId('pagina-no-encontrada')).toBeInTheDocument()
    expect(screen.queryByTestId('listado')).not.toBeInTheDocument()
  })
})
