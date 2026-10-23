import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// F-MIG-02 (FR-023): proveedores y vínculos reutilizan el asistente genérico —
// misma vista previa con errores por fila, mismo resultado y mismo registro de carga.

const mocks = vi.hoisted(() => ({
  usePuedeEscribir: vi.fn(),
  useEmpresaActiva: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useEmpresaActiva', () => ({ useEmpresaActiva: mocks.useEmpresaActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import { AsistenteImportacion } from './AsistenteImportacion'
import { ENTIDAD_PROVEEDORES } from './entidades/proveedores'
import { ENTIDAD_VINCULOS } from './entidades/vinculos'

const CSV_PROVEEDORES = [
  'Identificador del panel actual,Razón social,CUIT',
  'SINT-PRV-001,Proveedor Sintético 001 S.R.L.,30-90000010-9',
  'SINT-PRV-002,Proveedor Sintético 002 S.R.L.,30-00000000-0',
  '',
].join('\n')

const CSV_VINCULOS = [
  'SKU del producto,Identificador del proveedor en el panel actual,Código del proveedor',
  'SINT-SKU-001,SINT-PRV-001,COD-1',
  'sint-sku-001,SINT-PRV-001,COD-2',
  'SKU-QUE-NO-EXISTE,SINT-PRV-001,COD-3',
  '',
].join('\n')

const empresa = {
  empresas: [{ id: 'e-1', nombre: 'Empresa Sintética', esActiva: true }],
  esTodas: false, isLoading: false, isError: false, cambiando: false, errorCambio: null,
  cambiar: vi.fn(), cambiarATodas: vi.fn(), limpiarError: vi.fn(), refetch: vi.fn(),
}

function configurarRpc(entidad: string, previa: (fila: Record<string, string | number>) => { estado: string; motivo: string | null }) {
  mocks.rpc.mockImplementation(async (nombre: string, argumentos: Record<string, unknown>) => {
    const filas = (argumentos.p_filas ?? []) as Array<Record<string, string | number>>
    if (nombre === 'iniciar_carga_migracion') return { data: 'carga-1', error: null }
    if (nombre.startsWith('previsualizar_lote_')) {
      return { data: filas.map((fila) => ({ fila: fila.fila, ...previa(fila) })), error: null }
    }
    if (nombre.startsWith('aplicar_lote_')) {
      const buenas = filas.filter((fila) => previa(fila).estado !== 'error').length
      return { data: { nuevos: buenas, actualizados: 0, omitidos: 0, errores: [] }, error: null }
    }
    if (nombre === 'cerrar_carga_migracion') {
      return {
        data: {
          carga: 'carga-1', entidad, archivo: 'x.csv', estado: 'aplicada', error: null,
          filas_total: 2, nuevos: 2, actualizados: 0, con_error: 0, errores: [],
        },
        error: null,
      }
    }
    throw new Error(`RPC inesperada: ${nombre}`)
  })
}

async function subir(etiqueta: string, contenido: string, nombre: string, filas: number) {
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { files: [new File([contenido], nombre, { type: 'text/csv' })] } })
  await screen.findByText(new RegExp(`· ${filas} filas · UTF-8`))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar a la vista previa' }))
}

describe('AsistenteImportacion con proveedores y vínculos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useEmpresaActiva.mockReturnValue(empresa)
  })

  it('importa proveedores con las RPC de proveedores y ofrece seguir con los vínculos', async () => {
    configurarRpc('proveedores', () => ({ estado: 'nueva', motivo: null }))
    render(<MemoryRouter><AsistenteImportacion definicion={ENTIDAD_PROVEEDORES} /></MemoryRouter>)

    await subir('Archivo CSV de proveedores', CSV_PROVEEDORES, 'proveedores.csv', 2)
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 2 proveedores' }))

    expect(await screen.findByText('Importación lista: 2 proveedores nuevos, 0 actualizados, 0 con error')).toBeInTheDocument()
    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual([
      'previsualizar_lote_proveedores',
      'iniciar_carga_migracion',
      'aplicar_lote_proveedores',
      'cerrar_carga_migracion',
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('iniciar_carga_migracion', {
      p_entidad: 'proveedores', p_archivo: 'proveedores.csv', p_filas_total: 2,
    })
    expect(screen.getByRole('link', { name: /vínculos proveedor/ })).toHaveAttribute(
      'href', '/migracion/importar/vinculos-proveedor-producto',
    )
  })

  it('en la vista previa de vínculos marca SKU inexistente y SKU repetido, y no los importa', async () => {
    configurarRpc('vinculos_proveedor_producto', (fila) => (
      String(fila.sku).toUpperCase() === 'SKU-QUE-NO-EXISTE'
        ? { estado: 'error', motivo: 'El SKU no existe en el catálogo' }
        : { estado: 'nueva', motivo: null }
    ))
    render(<MemoryRouter><AsistenteImportacion definicion={ENTIDAD_VINCULOS} /></MemoryRouter>)

    await subir('Archivo CSV de vínculos', CSV_VINCULOS, 'vinculos.csv', 3)

    expect(await screen.findByRole('button', { name: 'Importar 1 vínculo' })).toBeInTheDocument()
    expect(screen.getByText('1 nuevo')).toBeInTheDocument()
    expect(screen.getByText('2 con error')).toBeInTheDocument()
    expect(screen.getByText(/El SKU no existe en el catálogo/)).toBeInTheDocument()
    expect(screen.getByText(/El SKU está repetido en el archivo/)).toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('previsualizar_lote_vinculos_proveedor_producto', expect.anything())
  })
})
