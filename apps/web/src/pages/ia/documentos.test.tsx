import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Resultado = { data?: unknown; error?: { message: string } | null }

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
  invoke: vi.fn(),
  useContextoPanel: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  documentos: [] as unknown[],
  versiones: [] as unknown[],
  insertDocumento: vi.fn(),
  updateDocumento: vi.fn(),
  deleteDocumento: vi.fn(),
  insertVersion: vi.fn(),
  errorDocumentos: null as { message: string } | null,
  errorInsertDocumento: null as { message: string } | null,
  errorInsertVersion: null as { message: string } | null,
  errorUpload: null as { message: string } | null,
  errorFeature: null as { message: string } | null,
  errorInvoke: null as { message: string } | null,
}))

vi.mock('../../context/ContextoPanel', () => ({ useContextoPanel: mocks.useContextoPanel }))
vi.mock('@refinedev/mui', () => ({ List: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('../../lib/supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: mocks.storageFrom },
    functions: { invoke: mocks.invoke },
  },
}))

import { IaDocumentos } from './documentos'

/** Cadena de PostgREST mínima: resuelve según tabla y operación. */
function crearCadena(tabla: string) {
  const operacion = { tipo: 'select', datos: undefined as unknown }
  const resolver = async (): Promise<Resultado> => {
    if (tabla === 'documentos') {
      if (operacion.tipo === 'insert') {
        mocks.insertDocumento(operacion.datos)
        return { data: { id: 'doc-nuevo' }, error: mocks.errorInsertDocumento }
      }
      if (operacion.tipo === 'update') {
        mocks.updateDocumento(operacion.datos)
        return { error: null }
      }
      if (operacion.tipo === 'delete') {
        mocks.deleteDocumento()
        return { error: null }
      }
      return { data: mocks.documentos, error: mocks.errorDocumentos }
    }
    if (tabla === 'versiones_documento') {
      if (operacion.tipo === 'insert') {
        mocks.insertVersion(operacion.datos)
        return { error: mocks.errorInsertVersion }
      }
      return { data: mocks.versiones, error: null }
    }
    return { data: [], error: null }
  }
  const api = {
    select: () => api,
    insert: (datos: unknown) => { operacion.tipo = 'insert'; operacion.datos = datos; return api },
    update: (datos: unknown) => { operacion.tipo = 'update'; operacion.datos = datos; return api },
    delete: () => { operacion.tipo = 'delete'; return api },
    eq: () => api,
    order: () => api,
    single: () => resolver(),
    then: (cumplido: (valor: Resultado) => unknown, rechazado: (motivo: unknown) => unknown) => resolver().then(cumplido, rechazado),
  }
  return api
}

const documento = { id: 'doc-1', nombre: 'contrato.txt', creado_en: '2026-01-01T00:00:00Z' }

const archivo = (nombre: string, contenido = 'texto', tipo = 'text/plain') => new File([contenido], nombre, { type: tipo })

function elegirArchivo(archivoElegido: File) {
  const { container } = render(<IaDocumentos />)
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('No se encontró el selector de archivos.')
  fireEvent.change(input, { target: { files: [archivoElegido] } })
  return { container }
}

async function montar() {
  const { container } = render(<IaDocumentos />)
  await screen.findByRole('button', { name: 'Subir documento' })
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('No se encontró el selector de archivos.')
  return input
}

describe('IaDocumentos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.documentos = []
    mocks.versiones = []
    mocks.errorDocumentos = null
    mocks.errorInsertDocumento = null
    mocks.errorInsertVersion = null
    mocks.errorUpload = null
    mocks.errorFeature = null
    mocks.errorInvoke = null
    mocks.useContextoPanel.mockReturnValue({
      contexto: { organizacion_id: 'org-1', es_superadmin: false, organizacion_nombre: 'Org', rol_efectivo: 'administrador', puede_escribir: true, puede_copiar_identificador_tecnico: false },
      isLoading: false,
      error: null,
      invalidar: vi.fn(),
    })
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    mocks.from.mockImplementation((tabla: string) => crearCadena(tabla))
    mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove })
    mocks.upload.mockImplementation(async () => ({ error: mocks.errorUpload }))
    mocks.remove.mockImplementation(async () => ({ error: null }))
    mocks.invoke.mockImplementation(async () => ({ data: {}, error: mocks.errorInvoke }))
  })

  it('rechaza un archivo de formato no admitido antes de tocar la base', async () => {
    const input = await montar()

    fireEvent.change(input, { target: { files: [archivo('programa.exe')] } })

    expect(await screen.findByText(/no es un formato admitido/)).toBeInTheDocument()
    expect(mocks.insertDocumento).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('rechaza un archivo de más de 20 MB antes de tocar la base', async () => {
    const input = await montar()
    const grande = { name: 'contrato.txt', size: 20 * 1024 * 1024 + 1 } as File

    fireEvent.change(input, { target: { files: [grande] } })

    expect(await screen.findByText(/pesa más de 20 MB/)).toBeInTheDocument()
    expect(mocks.insertDocumento).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('rechaza un archivo vacío antes de tocar la base', async () => {
    const input = await montar()

    fireEvent.change(input, { target: { files: [new File([], 'vacio.txt', { type: 'text/plain' })] } })

    expect(await screen.findByText(/está vacío/)).toBeInTheDocument()
    expect(mocks.insertDocumento).not.toHaveBeenCalled()
  })

  it('sube el archivo con el MIME del bucket y crea documento y versión', async () => {
    const input = await montar()

    fireEvent.change(input, { target: { files: [archivo('contrato.txt')] } })

    await waitFor(() => expect(mocks.insertVersion).toHaveBeenCalled())
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringContaining('org-1/doc-nuevo/'),
      expect.anything(),
      expect.objectContaining({ contentType: 'text/plain' }),
    )
    expect(mocks.insertDocumento).toHaveBeenCalledWith({ nombre: 'contrato.txt' })
    expect(mocks.insertVersion).toHaveBeenCalledWith(expect.objectContaining({ documento_id: 'doc-nuevo', estado: 'procesando' }))
    expect(mocks.invoke).toHaveBeenCalledWith('indexar-documento', { body: { version_id: expect.any(String) } })
  })

  it('si la subida falla, borra el documento creado y no deja el objeto en el bucket', async () => {
    mocks.errorUpload = { message: 'File size exceeded' }
    const input = await montar()

    fireEvent.change(input, { target: { files: [archivo('contrato.txt')] } })

    expect(await screen.findByText(/No pudimos subir el archivo/)).toBeInTheDocument()
    await waitFor(() => expect(mocks.deleteDocumento).toHaveBeenCalled())
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.insertVersion).not.toHaveBeenCalled()
  })

  it('si falla el registro de la versión, borra el objeto del bucket y el documento', async () => {
    mocks.errorInsertVersion = { message: 'violates foreign key constraint' }
    const input = await montar()

    fireEvent.change(input, { target: { files: [archivo('contrato.txt')] } })

    await waitFor(() => expect(mocks.deleteDocumento).toHaveBeenCalled())
    expect(mocks.remove).toHaveBeenCalledWith([expect.stringContaining('org-1/doc-nuevo/')])
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('si la indexación falla, no borra el documento ni el objeto (la versión ya quedó registrada)', async () => {
    mocks.errorInvoke = { message: 'No pudimos extraer texto de este documento' }
    const input = await montar()

    fireEvent.change(input, { target: { files: [archivo('contrato.txt')] } })

    expect(await screen.findByText(/No pudimos extraer texto/)).toBeInTheDocument()
    expect(mocks.deleteDocumento).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('el error al verificar la funcionalidad no se muestra como «no habilitada»', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })

    render(<IaDocumentos />)

    expect(await screen.findByText('No pudimos verificar la búsqueda documental.')).toBeInTheDocument()
    expect(screen.queryByText(/todavía no está habilitada/)).not.toBeInTheDocument()
  })

  it('el error al cargar los documentos no se muestra como lista vacía', async () => {
    mocks.errorDocumentos = { message: 'boom' }

    render(<IaDocumentos />)

    expect(await screen.findByText('No pudimos cargar los documentos.')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay documentos')).not.toBeInTheDocument()
  })

  it('«Actualizar» sube una versión del documento y actualiza su nombre', async () => {
    mocks.documentos = [documento]
    const { container } = render(<IaDocumentos />)
    await screen.findByText('contrato.txt')
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('No se encontró el selector de archivos.')

    fireEvent.click(screen.getByRole('button', { name: 'Actualizar (sube una nueva versión)' }))
    fireEvent.change(input, { target: { files: [archivo('contrato.pdf', 'pdf', 'application/pdf')] } })

    await waitFor(() => expect(mocks.insertVersion).toHaveBeenCalled())
    expect(mocks.insertDocumento).not.toHaveBeenCalled()
    expect(mocks.insertVersion).toHaveBeenCalledWith(expect.objectContaining({ documento_id: 'doc-1' }))
    expect(mocks.updateDocumento).toHaveBeenCalledWith({ nombre: 'contrato.pdf' })
  })

  it('si se cancela el selector de «Actualizar», la siguiente subida crea un documento nuevo', async () => {
    mocks.documentos = [documento]
    const { container } = render(<IaDocumentos />)
    await screen.findByText('contrato.txt')
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('No se encontró el selector de archivos.')

    // «Actualizar» del documento anterior y el usuario cancela el selector.
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar (sube una nueva versión)' }))
    // La siguiente subida viene del botón «Subir documento».
    fireEvent.click(screen.getByRole('button', { name: 'Subir documento' }))
    fireEvent.change(input, { target: { files: [archivo('otro.txt')] } })

    await waitFor(() => expect(mocks.insertVersion).toHaveBeenCalled())
    expect(mocks.insertDocumento).toHaveBeenCalledWith({ nombre: 'otro.txt' })
    expect(mocks.insertVersion).toHaveBeenCalledWith(expect.objectContaining({ documento_id: 'doc-nuevo' }))
  })
})
