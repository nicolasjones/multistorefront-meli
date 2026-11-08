import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  esAdmin: vi.fn(),
  contexto: vi.fn(),
  rpc: vi.fn(),
  subir: vi.fn(),
  quitar: vi.fn(),
  descargar: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { rpc: mocks.rpc, storage: { from: () => ({ upload: mocks.subir, remove: mocks.quitar }) } },
}))
vi.mock('../../hooks/useEsAdministrador', () => ({ useEsAdministrador: () => ({ esAdministrador: mocks.esAdmin(), isLoading: false }) }))
vi.mock('../../hooks/useContextoPanel', () => ({ useContextoPanel: () => mocks.contexto() }))
vi.mock('../../lib/exportarClientes', async (original) => ({
  ...(await original<typeof import('../../lib/exportarClientes')>()),
  descargarArchivo: mocks.descargar,
}))

import { ProductoCarga } from './carga'

const CSV = 'sku,nombre,categoria,precio_x1,imagenes\n9266a,Vidrio OLED,Accesorios > Nintendo,2500,a.jpg\n,Sin sku,Accesorios,100,\n'
const VALIDADAS = [
  { fila: 2, sku: '9266a', accion: 'actualiza', estado: 'ok', mensaje: 'OK' },
  { fila: 3, sku: '', accion: 'nuevo', estado: 'error', mensaje: 'Falta el SKU' },
]

const IMPORTACION = '5b1c9c2e-7f3a-4d51-9a0e-0c2f4a6b8d10'

function Ubicacion() {
  const ubicacion = useLocation()
  return <output data-testid="ubicacion">{ubicacion.pathname + ubicacion.search}</output>
}

const abrir = (entrada = '/productos/carga') => render(
  <MemoryRouter initialEntries={[entrada]}><ProductoCarga /><Ubicacion /></MemoryRouter>,
)
const elegirCsv = async (texto = CSV) => {
  const archivo = new File([texto], 'productos.csv', { type: 'text/csv' })
  fireEvent.change(await screen.findByTestId('entrada-csv'), { target: { files: [archivo] } })
}

describe('ProductoCarga', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.esAdmin.mockReturnValue(true)
    mocks.contexto.mockReturnValue({ contexto: { organizacion_id: 'org-1' }, isLoading: false })
    mocks.subir.mockResolvedValue({ error: null })
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'validar_importacion_productos') return { data: VALIDADAS, error: null }
      if (nombre === 'importacion_productos_habilitada') return { data: true, error: null }
      if (nombre === 'solicitar_importacion_productos') return { data: { importacion_id: IMPORTACION, estado: 'en_cola', importables: 1, omitidas: 1, reutilizada: false }, error: null }
      return { data: { estado: 'terminada', procesadas: 1, omitidas: 1, errores: [{ fila: 3, sku: '', mensaje: 'Falta el SKU' }] }, error: null }
    })
  })

  it('sin ser Administrador responde sin permiso (FR-101)', () => {
    mocks.esAdmin.mockReturnValue(false)
    abrir()
    expect(screen.getByText('No tenés permiso para importar productos.')).toBeTruthy()
    expect(screen.queryByText('Elegir CSV')).toBeNull()
  })

  it('muestra el panel de columnas y descarga la plantilla (FR-102)', () => {
    abrir()
    expect(screen.getByText('Columnas de la plantilla')).toBeTruthy()
    expect(screen.getByText('precio_x1 / x5 / x10 / x50')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar plantilla CSV' }))
    expect(mocks.descargar).toHaveBeenCalledTimes(1)
  })

  it('vista previa: tabla, Nuevo/Actualiza, contadores y texto fijo (FR-104)', async () => {
    abrir()
    await elegirCsv()
    expect(await screen.findByText('1 correctas')).toBeTruthy()
    expect(screen.getByText('0 con aviso')).toBeTruthy()
    expect(screen.getByText('1 con error')).toBeTruthy()
    expect(screen.getByText('Actualiza')).toBeTruthy()
    expect(screen.getByText('Falta el SKU')).toBeTruthy()
    expect(screen.getByText('Las filas con error no se importan. Los avisos se importan igual.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importar 1 producto' })).toBeTruthy()
  })

  it('sin las columnas obligatorias no hay vista previa', async () => {
    abrir()
    await elegirCsv('sku,nombre\n1,a\n')
    expect(await screen.findByText(/Faltan columnas obligatorias: categoria/)).toBeTruthy()
    // Solo la comprobación de la conexión al abrir: la planilla no llega al servidor.
    expect(mocks.rpc.mock.calls.map(([nombre]) => nombre)).toEqual(['importacion_productos_habilitada'])
  })

  it('Cancelar descarta la vista previa sin persistir nada (FR-107)', async () => {
    abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.queryByText('2 · Vista previa y validación')).toBeNull())
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'solicitar_importacion_productos')).toBe(false)
  })

  it('Importar encola y muestra el mensaje final y el reporte de errores (FR-107, FR-110, FR-111)', async () => {
    abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 producto' }))
    expect(await screen.findByText('Importación terminada. 1 producto procesado, 1 omitido por error. Ya figuran en Catálogo · Productos.')).toBeTruthy()
    expect(screen.getByText('Terminada')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar reporte de errores' }))
    expect(mocks.descargar).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['en_cola', 'En cola'],
    ['aplicando', 'Aplicando'],
    ['fallida', 'Fallida'],
  ])('muestra el estado %s (FR-111)', async (estado, rotulo) => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'validar_importacion_productos') return { data: VALIDADAS, error: null }
      if (nombre === 'importacion_productos_habilitada') return { data: true, error: null }
      if (nombre === 'solicitar_importacion_productos') return { data: { importacion_id: IMPORTACION, estado: 'en_cola', importables: 1, omitidas: 1 }, error: null }
      return { data: { estado, procesadas: 0, omitidas: 0, mensaje_fallo: 'Falló el worker', errores: [] }, error: null }
    })
    abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 producto' }))
    expect(await screen.findByText(rotulo)).toBeTruthy()
  })

  it('cambiar la empresa activa con una vista previa abierta no la altera (FR-113)', async () => {
    const { rerender } = abrir()
    await elegirCsv()
    await screen.findByText('1 correctas')
    mocks.contexto.mockReturnValue({ contexto: { organizacion_id: 'org-1', empresa_id: 'otra' }, isLoading: false })
    rerender(<MemoryRouter><ProductoCarga /></MemoryRouter>)
    expect(screen.getByText('1 correctas')).toBeTruthy()
    expect(screen.getByText('Falta el SKU')).toBeTruthy()
  })

  it('rechaza una imagen que no es JPG/PNG/WebP y sube las válidas (FR-103)', async () => {
    abrir()
    const buenas = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    const mala = new File([new Uint8Array([1])], 'b.gif', { type: 'image/gif' })
    fireEvent.change(await screen.findByTestId('entrada-imagenes'), { target: { files: [buenas, mala] } })
    expect(await screen.findByText('1 imagen cargada')).toBeTruthy()
    expect(screen.getByText('«b.gif» no es JPG, PNG ni WebP.')).toBeTruthy()
    expect(mocks.subir).toHaveBeenCalledTimes(1)
  })

  it('la importación en seguimiento queda en la URL y se rehidrata al volver o recargar (hallazgo 6)', async () => {
    const primera = abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 producto' }))
    await screen.findByText('Terminada')
    expect(screen.getByTestId('ubicacion').textContent).toBe(`/productos/carga?importacion=${IMPORTACION}`)
    primera.unmount()

    // «Volver» a la pantalla con la URL guardada: sin elegir ningún archivo se ve el estado de esa importación.
    mocks.rpc.mockClear()
    abrir(`/productos/carga?importacion=${IMPORTACION}`)
    expect(await screen.findByText('Terminada')).toBeTruthy()
    expect(mocks.rpc).toHaveBeenCalledWith('obtener_importacion_productos', { p_importacion_id: IMPORTACION })
    expect(screen.queryByText('Elegir CSV')).toBeNull()
  })

  it('un id de importación inválido en la URL se ignora y una inexistente (P0002) limpia la URL', async () => {
    abrir('/productos/carga?importacion=no-es-un-uuid')
    expect(await screen.findByText('Elegir CSV')).toBeTruthy()
    expect(mocks.rpc.mock.calls.some(([nombre]) => nombre === 'obtener_importacion_productos')).toBe(false)

    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'importacion_productos_habilitada') return { data: true, error: null }
      return { data: null, error: { code: 'P0002', message: 'La importación no existe' } }
    })
    abrir(`/productos/carga?importacion=${IMPORTACION}`)
    expect(await screen.findByText(/No encontramos esa importación/)).toBeTruthy()
    await waitFor(() => expect(screen.getAllByTestId('ubicacion').at(-1)?.textContent).toBe('/productos/carga'))
  })

  it('«Importar otro archivo» limpia la importación de la URL', async () => {
    abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 producto' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Importar otro archivo' }))
    await waitFor(() => expect(screen.getByTestId('ubicacion').textContent).toBe('/productos/carga'))
  })

  it('sin la conexión del importador avisa antes de pedir el CSV y no deja elegir archivos (hallazgo 7)', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => (nombre === 'importacion_productos_habilitada' ? { data: false, error: null } : { data: null, error: null }))
    abrir()
    expect(await screen.findByText(/todavía no tiene habilitada la importación de productos/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Elegir CSV' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Elegir imágenes' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('si la misma clave ya tenía una importación lo avisa (hallazgo 10)', async () => {
    mocks.rpc.mockImplementation(async (nombre: string) => {
      if (nombre === 'validar_importacion_productos') return { data: VALIDADAS, error: null }
      if (nombre === 'importacion_productos_habilitada') return { data: true, error: null }
      if (nombre === 'solicitar_importacion_productos') return { data: { importacion_id: IMPORTACION, estado: 'aplicando', importables: 1, omitidas: 1, reutilizada: true }, error: null }
      return { data: { estado: 'aplicando', procesadas: 0, omitidas: 0, errores: [] }, error: null }
    })
    abrir()
    await elegirCsv()
    fireEvent.click(await screen.findByRole('button', { name: 'Importar 1 producto' }))
    expect(await screen.findByText(/ya se había solicitado/)).toBeTruthy()
  })

  it('un doble clic en «Importar» solicita una sola vez', async () => {
    abrir()
    await elegirCsv()
    const boton = await screen.findByRole('button', { name: 'Importar 1 producto' })
    fireEvent.click(boton)
    fireEvent.click(boton)
    await screen.findByText('Terminada')
    expect(mocks.rpc.mock.calls.filter(([nombre]) => nombre === 'solicitar_importacion_productos')).toHaveLength(1)
  })

  it('si falla el procesamiento de las imágenes lo informa y la pantalla sigue usable (catch de elegirImagenes)', async () => {
    mocks.subir.mockRejectedValue(new Error('storage caído'))
    abrir()
    const buena = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })
    fireEvent.change(await screen.findByTestId('entrada-imagenes'), { target: { files: [buena] } })
    expect(await screen.findByText('No pudimos procesar las imágenes.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Elegir imágenes' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('un nombre de imagen repetido entre selecciones conserva la primera y avisa (hallazgo 8)', async () => {
    abrir()
    const entrada = await screen.findByTestId('entrada-imagenes')
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })] } })
    await screen.findByText('1 imagen cargada')
    fireEvent.change(entrada, { target: { files: [new File([new Uint8Array([2])], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/«a\.jpg» ya estaba cargada: se mantiene la primera/)).toBeTruthy()
    expect(screen.getByText('1 imagen cargada')).toBeTruthy()
    expect(mocks.subir).toHaveBeenCalledTimes(1)
  })
})
