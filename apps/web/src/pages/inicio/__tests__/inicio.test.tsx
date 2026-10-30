import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ niveles: {} as Record<string, string>, permisos: { permisos: [], isLoading: false, recargar: () => {} } as unknown, nombre: 'Ada' as string | null }))
vi.mock('../../../hooks/useNivelSeccion', () => ({ useNivelSeccion: (s: string) => ({ nivel: mocks.niveles[s] ?? 'ninguno', isLoading: false }) }))
vi.mock('../../../context/PermisosPanel', () => ({ usePermisosPanel: () => mocks.permisos }))
vi.mock('../useNombrePerfil', () => ({ useNombrePerfil: () => mocks.nombre }))
vi.mock('../TarjetaEmpresas', () => ({ TarjetaEmpresas: () => <div>tarjeta empresas</div> }))
vi.mock('../TarjetaStock', () => ({ TarjetaStock: () => <div>tarjeta stock</div> }))
vi.mock('../TarjetaConsultas', () => ({ TarjetaConsultas: () => <div>tarjeta consultas</div> }))
vi.mock('../TarjetaDolar', () => ({ TarjetaDolar: ({ puedeEditar }: { puedeEditar: boolean }) => <div>tarjeta dolar {puedeEditar ? 'edita' : 'lee'}</div> }))
vi.mock('../AccesosDirectos', () => ({ AccesosDirectos: () => <div>accesos</div> }))

import { InicioPage } from '..'

const montar = () => render(<MemoryRouter><InicioPage /></MemoryRouter>)

describe('Inicio (F-INI-01)', () => {
  beforeEach(() => {
    mocks.niveles = { stock: 'lectura', consultas: 'lectura', cotizacion_dolar: 'edicion' }
    mocks.permisos = { permisos: [], isLoading: false, recargar: () => {} }
    mocks.nombre = 'Ada'
  })

  it('saludo, fecha y subtítulo reemplazan al Home del template (FR-001)', () => {
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Buen día, Ada' })).toBeInTheDocument()
    expect(screen.getByText(/stock, consultas y dólar de tus tiendas/)).toHaveTextContent(/^\p{Lu}\p{Ll}+ \d{1,2} de \p{Ll}+ · /u)
    expect(screen.queryByText(/Automation Platform Template/)).not.toBeInTheDocument()
  })

  it('sin nombre de perfil saluda sin inventar uno ni mostrar el correo (FR-011)', () => {
    mocks.nombre = null
    montar()
    expect(screen.getByRole('heading', { level: 1, name: 'Buen día' })).toBeInTheDocument()
  })

  it('muestra un estado de carga mientras llegan los permisos', () => {
    mocks.permisos = { permisos: null, isLoading: true, recargar: () => {} }
    montar()
    expect(screen.getByRole('status', { name: 'Cargando contenido' })).toBeInTheDocument()
    expect(screen.queryByText('tarjeta stock')).not.toBeInTheDocument()
  })

  it('un rol sin ninguna sección muestra el estado vacío, nunca una pantalla en blanco', () => {
    mocks.niveles = {}
    montar()
    expect(screen.getByText('Tu rol todavía no tiene secciones habilitadas')).toBeInTheDocument()
    expect(screen.queryByText('tarjeta empresas')).not.toBeInTheDocument()
  })
})
