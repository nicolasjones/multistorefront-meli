import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  usePuedeEscribir: vi.fn(),
  useEmpresaActiva: vi.fn(),
  rpc: vi.fn(),
  descargarCsv: vi.fn(),
}))

vi.mock('../../hooks/usePuedeEscribir', () => ({ usePuedeEscribir: mocks.usePuedeEscribir }))
vi.mock('../../hooks/useEmpresaActiva', () => ({ useEmpresaActiva: mocks.useEmpresaActiva }))
vi.mock('../../components/pagina/ContextoOrganizacionActiva', () => ({ ContextoOrganizacionActiva: () => null }))
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))
vi.mock('../../lib/migracionCsv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/migracionCsv')>()
  return { ...actual, descargarCsv: mocks.descargarCsv }
})

import { AsistenteImportacion } from './AsistenteImportacion'
import { ENTIDAD_CLIENTES } from './entidades/clientes'

const CSV = [
  'Identificador del panel actual,Nombre o razón social,Tipo de cliente',
  'SINT-001,Cliente Sintético Uno,Mayorista',
  'SINT-002,Cliente Sintético Dos,Minorista',
  '',
].join('\n')

const CSV_CON_ERROR = [
  'Identificador del panel actual,Nombre o razón social,Tipo de cliente',
  'SINT-001,Cliente Sintético Uno,Mayorista',
  'SINT-002,,Minorista',
  '',
].join('\n')

const archivo = (contenido = CSV, nombre = 'clientes.csv') => new File([contenido], nombre, { type: 'text/csv' })

const empresa = (nombre: string, id = 'e-1') => ({
  empresas: [{ id, nombre, esActiva: true }],
  esTodas: false,
  isLoading: false,
  isError: false,
  cambiando: false,
  errorCambio: null,
  cambiar: vi.fn(),
  cambiarATodas: vi.fn(),
  limpiarError: vi.fn(),
  refetch: vi.fn(),
})

function configurarRpc({ aplicarFalla = false } = {}) {
  let intentosAplicar = 0
  mocks.rpc.mockImplementation(async (nombre: string, argumentos: Record<string, unknown>) => {
    if (nombre === 'iniciar_carga_migracion') {
      return { data: 'carga-1', error: null }
    }
    if (nombre === 'previsualizar_lote_clientes') {
      const filas = argumentos.p_filas as Array<Record<string, string | number>>
      return {
        data: filas.map((fila) => fila.nombre === ''
          ? { fila: fila.fila, estado: 'error', motivo: 'Falta el nombre o la razón social' }
          : { fila: fila.fila, estado: 'nueva', motivo: null }),
        error: null,
      }
    }
    if (nombre === 'aplicar_lote_clientes') {
      intentosAplicar += 1
      if (aplicarFalla && intentosAplicar === 1) {
        return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
      }
      const filas = argumentos.p_filas as Array<Record<string, string | number>>
      return {
        data: { nuevos: filas.filter((fila) => fila.nombre !== '').length, actualizados: 0, omitidos: 0, errores: [] },
        error: null,
      }
    }
    if (nombre === 'cerrar_carga_migracion') {
      return {
        data: {
          carga: 'carga-1',
          entidad: 'clientes',
          archivo: 'clientes.csv',
          estado: 'aplicada',
          error: null,
          filas_total: 2,
          nuevos: 2,
          actualizados: 0,
          con_error: 0,
          errores: [],
        },
        error: null,
      }
    }
    throw new Error(`RPC inesperada: ${nombre}`)
  })
}

const abrir = () => render(<AsistenteImportacion definicion={ENTIDAD_CLIENTES} />)

async function subir(contenido = CSV, nombre = 'clientes.csv') {
  fireEvent.change(screen.getByLabelText('Archivo CSV de clientes'), { target: { files: [archivo(contenido, nombre)] } })
  await screen.findByText(/· 2 filas · UTF-8/)
}

function botonContinuar() {
  fireEvent.click(screen.getByRole('button', { name: 'Continuar a la vista previa' }))
}

async function importar(nombre: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: nombre }))
}

describe('AsistenteImportacion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: true, isLoading: false })
    mocks.useEmpresaActiva.mockReturnValue(empresa('Empresa Sintética'))
    configurarRpc()
  })

  it('sube el CSV, auto-mapea y muestra la vista previa con los totales', async () => {
    abrir()
    await subir()
    expect(screen.getByText(/clientes\.csv · 2 filas · UTF-8/)).toBeInTheDocument()
    expect(screen.getByLabelText('Columna «Identificador del panel actual»')).toHaveTextContent('Identificador del panel actual')
    expect(screen.getByLabelText('Columna «Nombre o razón social»')).toHaveTextContent('Nombre o razón social')

    botonContinuar()

    expect(await screen.findByRole('button', { name: 'Importar 2 clientes' })).toBeInTheDocument()
    expect(screen.getByText('2 nuevos')).toBeInTheDocument()
    expect(screen.getByText('0 a actualizar')).toBeInTheDocument()
    expect(screen.getByText('0 con error')).toBeInTheDocument()
  })

  it('aplica por lotes, cierra la carga y muestra el resultado', async () => {
    abrir()
    await subir()
    botonContinuar()
    await importar(/Importar 2 clientes/)

    expect(await screen.findByText('Importación lista: 2 clientes nuevos, 0 actualizados, 0 con error')).toBeInTheDocument()
    const nombres = mocks.rpc.mock.calls.map(([nombre]) => nombre)
    expect(nombres).toEqual([
      'previsualizar_lote_clientes',
      'iniciar_carga_migracion',
      'aplicar_lote_clientes',
      'cerrar_carga_migracion',
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('iniciar_carga_migracion', {
      p_entidad: 'clientes',
      p_archivo: 'clientes.csv',
      p_filas_total: 2,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('aplicar_lote_clientes', expect.objectContaining({
      p_carga: 'carga-1',
      p_lote: 1,
    }))
  })

  it('muestra las filas con error y no las importa, pero registra su resultado', async () => {
    configurarRpc()
    mocks.rpc.mockImplementation(async (nombre: string, _argumentos: Record<string, unknown>) => {
      if (nombre === 'previsualizar_lote_clientes') {
        return {
          data: [
            { fila: 2, estado: 'nueva', motivo: null },
            { fila: 3, estado: 'error', motivo: 'Falta el nombre o la razón social' },
          ],
          error: null,
        }
      }
      if (nombre === 'iniciar_carga_migracion') return { data: 'carga-1', error: null }
      if (nombre === 'aplicar_lote_clientes') {
        return { data: { nuevos: 1, actualizados: 0, omitidos: 0, errores: [{ fila: 3, motivo: 'Falta el nombre o la razón social' }] }, error: null }
      }
      return {
        data: {
          carga: 'carga-1', entidad: 'clientes', archivo: 'clientes.csv', estado: 'aplicada', error: null,
          filas_total: 2, nuevos: 1, actualizados: 0, con_error: 1,
          errores: [{ fila: 3, motivo: 'Falta el nombre o la razón social' }],
        },
        error: null,
      }
    })

    abrir()
    await subir(CSV_CON_ERROR)
    botonContinuar()

    expect(await screen.findByText('1 fila con error. No se importan.')).toBeInTheDocument()
    expect(screen.getByText('Falta el nombre o la razón social (filas 3).')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Filas con error' })).toBeInTheDocument()

    await importar(/Importar 1 cliente/)
    expect(await screen.findByText('Importación lista: 1 cliente nuevo, 0 actualizados, 1 con error')).toBeInTheDocument()
    // Las filas con error también viajan para que quede su registro por fila (FR-008).
    expect(mocks.rpc).toHaveBeenCalledWith('aplicar_lote_clientes', expect.objectContaining({
      p_filas: expect.arrayContaining([
        expect.objectContaining({ fila: 2 }),
        expect.objectContaining({ fila: 3 }),
      ]),
    }))
  })

  it('si un lote falla, ofrece reintentar con la misma carga sin duplicar', async () => {
    configurarRpc({ aplicarFalla: true })
    abrir()
    await subir()
    botonContinuar()
    await importar(/Importar 2 clientes/)

    expect(await screen.findByText('No pudimos aplicar la importación.')).toBeInTheDocument()
    expect(screen.getByText(/lo ya cargado no se duplica/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('Importación lista: 2 clientes nuevos, 0 actualizados, 0 con error')).toBeInTheDocument()
    const inicios = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'iniciar_carga_migracion')
    expect(inicios).toHaveLength(1)
    const aplicaciones = mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'aplicar_lote_clientes')
    expect(aplicaciones).toHaveLength(2)
    expect(aplicaciones[1][1]).toMatchObject({ p_carga: 'carga-1' })
  })

  it('muestra un error claro si el archivo no es CSV y no avanza', async () => {
    abrir()
    fireEvent.change(screen.getByLabelText('Archivo CSV de clientes'), {
      target: { files: [archivo('contenido', 'clientes.xlsx')] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/no es un archivo \.csv/)
    expect(screen.queryByRole('button', { name: 'Continuar a la vista previa' })).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('descarga la plantilla con las columnas esperadas', () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar plantilla CSV' }))
    expect(mocks.descargarCsv).toHaveBeenCalledWith(
      'clientes.csv',
      expect.stringContaining('Identificador del panel actual,Nombre o razón social'),
    )
  })

  it('declara que la empresa activa no aplica y no cambia el lote al cambiar de empresa', async () => {
    const { rerender } = abrir()
    expect(screen.getByText(/Empresa activa: Empresa Sintética/)).toBeInTheDocument()
    expect(screen.getByText(/No aplica filtrado por empresa/)).toBeInTheDocument()

    await subir()
    mocks.useEmpresaActiva.mockReturnValue(empresa('Otra Empresa', 'e-2'))
    rerender(<AsistenteImportacion definicion={ENTIDAD_CLIENTES} />)

    expect(screen.getByText(/Empresa activa: Otra Empresa/)).toBeInTheDocument()
    // El archivo y el mapeo siguen intactos después del cambio de empresa.
    expect(screen.getByText(/clientes\.csv · 2 filas · UTF-8/)).toBeInTheDocument()
    expect(screen.getByLabelText('Columna «Identificador del panel actual»')).toHaveTextContent('Identificador del panel actual')

    botonContinuar()
    await importar(/Importar 2 clientes/)
    await screen.findByText(/Importación lista/)

    for (const [, argumentos] of mocks.rpc.mock.calls) {
      expect(argumentos).not.toHaveProperty('p_empresa_id')
    }
  })

  it('sin permiso de Administrador no muestra el asistente', () => {
    mocks.usePuedeEscribir.mockReturnValue({ puedeEscribir: false, isLoading: false })
    abrir()

    expect(screen.getByText('Sin permiso')).toBeInTheDocument()
    expect(screen.queryByLabelText('Archivo CSV de clientes')).not.toBeInTheDocument()
  })
})
