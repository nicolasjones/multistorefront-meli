import { MemoryRouter } from 'react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configurarFiltro, consultasExportacionTotal, exportacionTotal, falso, reiniciarFalso, responderExportacionTotal } from './soporteTest'

vi.mock('../../lib/supabase', async () => ({ supabaseClient: (await import('./soporteTest')).supabaseFalso }))
const permiso = vi.hoisted(() => ({ puedeEscribir: true, esSuperadmin: false }))
vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: () => ({ puedeEscribir: permiso.puedeEscribir, isLoading: false }) }))
vi.mock('../../hooks/useIsSuperadmin', () => ({ useIsSuperadmin: () => ({ isSuperadmin: permiso.esSuperadmin, isLoading: false }) }))
vi.mock('../../hooks/useFiltroPorEmpresaActiva', () => ({ useFiltroPorEmpresaActiva: (...args: unknown[]) => falso.filtro(...args) }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))

import { ImportacionesList } from './list'

const abrir = () => render(<MemoryRouter><ImportacionesList /></MemoryRouter>)
const bloque = async () => within(await screen.findByRole('region', { name: 'Exportar todos los datos' }))

// F-OPS-06 (MSF-396): bloque «Exportar todos los datos» de /importaciones.
describe('[MSF-396:T026] Exportar todos los datos (FR-039, FR-040)', () => {
  beforeEach(() => {
    reiniciarFalso()
    configurarFiltro(null)
    permiso.puedeEscribir = true
    permiso.esSuperadmin = false
    falso.rpc.mockResolvedValue({ data: [{ proceso_id: 'p-900', ejecucion_id: 'ej-900', estado: 'pendiente', reutilizado: false }], error: null })
  })
  afterEach(() => vi.restoreAllMocks())

  it('el administrador ve el bloque con su botón y el estado vacío', async () => {
    abrir()
    const b = await bloque()
    expect(b.getByRole('heading', { name: 'Exportar todos los datos' })).toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Exportar todos los datos' })).toBeEnabled()
    expect(await b.findByText('Todavía no pediste una exportación total.')).toBeInTheDocument()
  })

  it('un superadmin con acceso de soporte NO ve el bloque ni consulta nada (la base también lo rechaza)', () => {
    permiso.esSuperadmin = true
    abrir()
    expect(screen.queryByRole('region', { name: 'Exportar todos los datos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exportar todos los datos' })).not.toBeInTheDocument()
    expect(consultasExportacionTotal()).toHaveLength(0)
  })

  it('quien no es administrador no ve el bloque ni consulta nada', () => {
    permiso.puedeEscribir = false
    abrir()
    expect(screen.queryByRole('region', { name: 'Exportar todos los datos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exportar todos los datos' })).not.toBeInTheDocument()
    expect(consultasExportacionTotal()).toHaveLength(0)
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  it('el botón abre una confirmación que explica qué se descarga, y no pide nada hasta confirmar', async () => {
    abrir()
    const b = await bloque()
    fireEvent.click(b.getByRole('button', { name: 'Exportar todos los datos' }))
    const dialogo = await screen.findByRole('dialog', { name: '¿Exportar todos los datos de la organización?' })
    expect(within(dialogo).getByText(/archivo ZIP con una planilla CSV por cada tipo de dato/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/No incluye contraseñas, claves ni datos de acceso/)).toBeInTheDocument()
    expect(falso.rpc).not.toHaveBeenCalled()
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(falso.rpc).not.toHaveBeenCalled()
  })

  it('al confirmar pide la exportación total y refleja el proceso en curso', async () => {
    abrir()
    const b = await bloque()
    fireEvent.click(b.getByRole('button', { name: 'Exportar todos los datos' }))
    const dialogo = await screen.findByRole('dialog')
    responderExportacionTotal(exportacionTotal({ estado: 'en_curso', procesados: 3, total: 10, finalizado_en: null }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Sí, exportar' }))
    await waitFor(() => expect(falso.rpc).toHaveBeenCalledWith('solicitar_exportacion_total'))
    expect(await b.findByText('Estamos preparando tu exportación.')).toBeInTheDocument()
    expect(b.getByText(/3 de 10 grupos de datos listos/)).toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Exportación en curso' })).toBeDisabled()
    expect(b.getByRole('progressbar', { name: 'Avance de la exportación total' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('un error al pedir se explica en el diálogo, con el motivo en castellano', async () => {
    falso.rpc.mockResolvedValue({ data: null, error: { message: 'SIN_CONEXION_EXPORTACION: la organización no tiene habilitado el servidor de exportaciones' } })
    abrir()
    const b = await bloque()
    fireEvent.click(b.getByRole('button', { name: 'Exportar todos los datos' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, exportar' }))
    expect(await screen.findByText(/todavía no tiene habilitado el servidor de exportaciones/)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('con la exportación lista muestra «Descargar» y baja el ZIP con una URL firmada de vida corta', async () => {
    responderExportacionTotal(exportacionTotal())
    falso.descarga.mockResolvedValue({ data: { signedUrl: 'https://storage.example/firmada' }, error: null })
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    abrir()
    const b = await bloque()
    expect(await b.findByText('Tu exportación está lista.')).toBeInTheDocument()
    fireEvent.click(b.getByRole('button', { name: 'Descargar' }))
    await waitFor(() => expect(clic).toHaveBeenCalled())
    expect(falso.descarga).toHaveBeenCalledWith('exportaciones-organizacion', 'org-1/ej-900.zip', 60, expect.objectContaining({ download: expect.stringMatching(/^exportacion-total-\d{4}-\d{2}-\d{2}\.zip$/) }))
  })

  it('si no se puede preparar la descarga lo dice y deja reintentar', async () => {
    responderExportacionTotal(exportacionTotal())
    falso.descarga.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    abrir()
    const b = await bloque()
    fireEvent.click(await b.findByRole('button', { name: 'Descargar' }))
    expect(await b.findByText(/No pudimos preparar la descarga/)).toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Descargar' })).toBeEnabled()
  })

  it('con errores de conjunto avisa que algo quedó incompleto y igual deja descargar', async () => {
    responderExportacionTotal(exportacionTotal({ estado: 'con_errores', con_errores: 1 }))
    abrir()
    const b = await bloque()
    expect(await b.findByText(/Algunos grupos de datos no se pudieron leer completos/)).toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Descargar' })).toBeInTheDocument()
  })

  it('una exportación fallida lo dice y deja pedir otra', async () => {
    responderExportacionTotal(exportacionTotal({ estado: 'fallido', ejecucion_id: null }))
    abrir()
    const b = await bloque()
    expect(await b.findByText('La última exportación no pudo completarse.')).toBeInTheDocument()
    expect(b.queryByRole('button', { name: 'Descargar' })).not.toBeInTheDocument()
    expect(b.getByRole('button', { name: 'Exportar todos los datos' })).toBeEnabled()
  })

  it('un error al leer el estado ofrece reintentar', async () => {
    responderExportacionTotal(new Error('falló'))
    abrir()
    const b = await bloque()
    expect(await b.findByText('No pudimos ver el estado de la exportación total.')).toBeInTheDocument()
    responderExportacionTotal(exportacionTotal())
    fireEvent.click(b.getByRole('button', { name: 'Reintentar' }))
    expect(await b.findByText('Tu exportación está lista.')).toBeInTheDocument()
  })

  it('no muestra identificadores técnicos', async () => {
    responderExportacionTotal(exportacionTotal())
    abrir()
    const b = await bloque()
    await b.findByText('Tu exportación está lista.')
    const texto = document.body.textContent ?? ''
    expect(texto).not.toMatch(/exportacion_total|ej-900|org-1|funcionalidad/)
  })
})
