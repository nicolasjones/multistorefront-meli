import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  solicitarDocumento: vi.fn(),
  esperarDocumento: vi.fn(),
  urlFirmadaDocumento: vi.fn(),
  abrir: vi.fn(),
  registrarImpresion: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/ventasImpresiones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasImpresiones')>()),
  registrarImpresion: mocks.registrarImpresion,
}))
vi.mock('../../lib/ventasImpresion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasImpresion')>()),
  solicitarDocumento: mocks.solicitarDocumento,
  esperarDocumento: mocks.esperarDocumento,
  urlFirmadaDocumento: mocks.urlFirmadaDocumento,
}))

import { ImprimirComprobanteDialog } from './ImprimirComprobanteDialog'
import type { Comprobante } from '../../lib/ventas'
import type { DocumentoComprobante } from '../../lib/ventasImpresion'

const comprobante = (cambios: Partial<Comprobante> = {}): Comprobante =>
  ({ id: 'k-1', tipo: 'factura', numero: '00000001', estado: 'confirmada', empresa_id: 'e-1', ...cambios }) as Comprobante

const documento = (cambios: Partial<DocumentoComprobante> = {}): DocumentoComprobante => ({
  id: 'd-1', comprobante_id: 'k-1', empresa_id: 'e-1', tipo_documento: 'factura', estado: 'pendiente', ruta: null,
  error: null, solicitado_en: '2026-10-25T10:00:00Z', generado_en: null, ...cambios,
})
const generado = documento({ estado: 'generado', ruta: 'o/e/k/d-1.pdf' })

const abrir = (c: Comprobante = comprobante(), tipoInicial?: 'factura' | 'remito') => {
  const onCerrar = vi.fn()
  const onImpreso = vi.fn()
  render(<ImprimirComprobanteDialog open comprobante={c} tipoInicial={tipoInicial} onCerrar={onCerrar} onImpreso={onImpreso} />)
  return { onCerrar, onImpreso }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(window, 'open').mockImplementation(mocks.abrir)
  mocks.abrir.mockReturnValue({ opener: null })
  mocks.urlFirmadaDocumento.mockResolvedValue('https://storage/doc.pdf?token=1')
  mocks.registrarImpresion.mockResolvedValue({ id: 'i-1', documento_id: 'd-1', reimpresion: false })
})

describe('ImprimirComprobanteDialog (F-VTA-19)', () => {
  it('muestra el texto, los documentos elegibles con su subtítulo y los botones (FR-011)', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Imprimir comprobante' })).toBeInTheDocument()
    expect(screen.getByText('Se marca como impreso con fecha y hora.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Factura 00000001/ })).toBeChecked()
    expect(screen.getByText('Original para el cliente')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Remito/ })).not.toBeChecked()
    expect(screen.getByText('Para el armado y la entrega')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeEnabled()
    expect(mocks.solicitarDocumento).not.toHaveBeenCalled()
  })

  it('abre con el remito preseleccionado', () => {
    abrir(comprobante(), 'remito')
    expect(screen.getByRole('radio', { name: /Remito/ })).toBeChecked()
  })

  it('no ofrece documentos ni deja imprimir si el comprobante no es imprimible', () => {
    abrir(comprobante({ estado: 'borrador' }))
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
  })

  it('pide el documento elegido, muestra «Preparando documento…», consulta el avance y abre el PDF', async () => {
    let resolver: (valor: DocumentoComprobante) => void = () => undefined
    mocks.solicitarDocumento.mockResolvedValue(documento())
    mocks.esperarDocumento.mockReturnValue(new Promise((resolve) => { resolver = resolve }))
    const { onImpreso } = abrir()

    fireEvent.click(screen.getByRole('radio', { name: /Remito/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(await screen.findByText('Preparando documento…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeDisabled()
    expect(mocks.solicitarDocumento).toHaveBeenCalledWith('k-1', 'remito')
    expect(mocks.esperarDocumento).toHaveBeenCalledWith('d-1', expect.objectContaining({ signal: expect.any(AbortSignal) }))

    resolver(generado)
    await waitFor(() => expect(onImpreso).toHaveBeenCalledWith('remito'))
    expect(mocks.urlFirmadaDocumento).toHaveBeenCalledWith('o/e/k/d-1.pdf')
    expect(mocks.abrir).toHaveBeenCalledWith('https://storage/doc.pdf?token=1', '_blank')
  })

  it('un documento ya generado se abre sin consultar el avance (reutilización)', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    const { onImpreso } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    await waitFor(() => expect(onImpreso).toHaveBeenCalledWith('factura'))
    expect(mocks.esperarDocumento).not.toHaveBeenCalled()
  })

  it('muestra el error con «Reintentar» y reintenta con un pedido nuevo', async () => {
    mocks.solicitarDocumento.mockResolvedValueOnce(documento()).mockResolvedValueOnce(generado)
    mocks.esperarDocumento.mockRejectedValueOnce(Object.assign(new Error('No se pudo generar el documento'), { name: 'ErrorDocumento' }))
    const { onImpreso } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos preparar el documento/)
    expect(onImpreso).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onImpreso).toHaveBeenCalledWith('factura'))
    expect(mocks.solicitarDocumento).toHaveBeenCalledTimes(2)
  })

  it('muestra el mensaje de la base cuando rechaza el pedido', async () => {
    mocks.solicitarDocumento.mockRejectedValue({ code: '22023', message: 'La factura tiene que estar confirmada para imprimirla' })
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(await screen.findByText('La factura tiene que estar confirmada para imprimirla')).toBeInTheDocument()
  })

  it('si el navegador bloquea la ventana ofrece el enlace y no confirma todavía', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    mocks.abrir.mockReturnValue(null)
    const { onImpreso } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    const enlace = await screen.findByRole('link', { name: 'Abrir documento' })
    expect(enlace).toHaveAttribute('href', 'https://storage/doc.pdf?token=1')
    expect(onImpreso).not.toHaveBeenCalled()
    fireEvent.click(enlace)
    expect(onImpreso).toHaveBeenCalledWith('factura')
  })

  it('«Cancelar» cierra sin pedir nada', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.solicitarDocumento).not.toHaveBeenCalled()
  })

  it('cerrar el diálogo corta la consulta del avance', async () => {
    mocks.solicitarDocumento.mockResolvedValue(documento())
    let senal: AbortSignal | undefined
    mocks.esperarDocumento.mockImplementation((_id: string, opciones: { signal: AbortSignal }) => {
      senal = opciones.signal
      return new Promise(() => undefined)
    })
    const { unmount } = (() => {
      const onCerrar = vi.fn()
      return render(<ImprimirComprobanteDialog open comprobante={comprobante()} onCerrar={onCerrar} onImpreso={vi.fn()} />)
    })()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    await waitFor(() => expect(senal).toBeDefined())
    unmount()
    expect(senal?.aborted).toBe(true)
  })
})

describe('ImprimirComprobanteDialog · marca de impreso (F-VTA-21)', () => {
  it('registra la impresión del documento generado al confirmar «Imprimir» y recién después abre el PDF (FR-034)', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    const { onImpreso } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    await waitFor(() => expect(onImpreso).toHaveBeenCalledWith('factura'))
    expect(mocks.registrarImpresion).toHaveBeenCalledTimes(1)
    expect(mocks.registrarImpresion).toHaveBeenCalledWith('d-1')
    expect(mocks.registrarImpresion.mock.invocationCallOrder[0]).toBeLessThan(mocks.abrir.mock.invocationCallOrder[0])
  })

  it('no registra nada si la generación falló (FR-034)', async () => {
    mocks.solicitarDocumento.mockResolvedValue(documento())
    mocks.esperarDocumento.mockRejectedValue(Object.assign(new Error('No se pudo generar el documento'), { name: 'ErrorDocumento' }))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(mocks.registrarImpresion).not.toHaveBeenCalled()
  })

  it('no registra nada si se cancela el diálogo (FR-034)', () => {
    const { onCerrar } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalledTimes(1)
    expect(mocks.registrarImpresion).not.toHaveBeenCalled()
  })

  it('si el registro falla avisa, no abre el PDF y «Reintentar» registra una sola vez (FR-034)', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    mocks.registrarImpresion.mockRejectedValueOnce({ code: '42501', message: 'sin permiso' })
    const { onImpreso } = abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no pudimos registrar la impresión/)
    expect(mocks.abrir).not.toHaveBeenCalled()
    expect(onImpreso).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    await waitFor(() => expect(onImpreso).toHaveBeenCalledWith('factura'))
    expect(mocks.registrarImpresion).toHaveBeenCalledTimes(2)
  })

  it('«Imprimir» sigue disponible tras imprimir y cada impresión se registra otra vez (FR-035)', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    const { onImpreso } = abrir()
    const imprimir = screen.getByRole('button', { name: 'Imprimir' })

    fireEvent.click(imprimir)
    await waitFor(() => expect(onImpreso).toHaveBeenCalledTimes(1))
    expect(imprimir).toBeEnabled()

    fireEvent.click(imprimir)
    await waitFor(() => expect(onImpreso).toHaveBeenCalledTimes(2))
    expect(mocks.registrarImpresion).toHaveBeenCalledTimes(2)
    expect(mocks.esperarDocumento).not.toHaveBeenCalled()
  })
})
