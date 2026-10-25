import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  solicitarDocumento: vi.fn(),
  esperarDocumento: vi.fn(),
  urlFirmadaDocumento: vi.fn(),
  registrarImpresion: vi.fn(),
  ultimasImpresiones: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/ventasImpresiones', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasImpresiones')>()),
  registrarImpresion: mocks.registrarImpresion,
  ultimasImpresiones: mocks.ultimasImpresiones,
}))
vi.mock('../../lib/ventasImpresion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ventasImpresion')>()),
  solicitarDocumento: mocks.solicitarDocumento,
  esperarDocumento: mocks.esperarDocumento,
  urlFirmadaDocumento: mocks.urlFirmadaDocumento,
}))

import { AVISO_CAMBIO_DE_TIENDA, DocumentosComprobante } from './DocumentosComprobante'
import type { Comprobante } from '../../lib/ventas'
import type { TipoDocumento } from '../../lib/ventasImpresion'

const comprobante = (cambios: Partial<Comprobante> = {}): Comprobante =>
  ({ id: 'k-1', tipo: 'factura', numero: '00000001', estado: 'confirmada', empresa_id: 'e-1', ...cambios }) as Comprobante

// Hace de pantalla: dueña del estado del diálogo, como `ComprobanteVenta`.
function Pantalla({ c, puedeImprimir = true, empresa }: { c: Comprobante; puedeImprimir?: boolean; empresa: string | null }) {
  const [dialogo, setDialogo] = useState<TipoDocumento | null>(null)
  return (
    <>
      <button type="button" onClick={() => setDialogo('factura')}>Imprimir</button>
      <DocumentosComprobante
        comprobante={c}
        puedeImprimir={puedeImprimir}
        empresaActivaId={empresa}
        dialogo={dialogo}
        onAbrir={setDialogo}
        onCerrar={() => setDialogo(null)}
      />
    </>
  )
}

const generado = { id: 'd-1', estado: 'generado', ruta: 'o/e/k/d-1.pdf' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as Window)
  mocks.urlFirmadaDocumento.mockResolvedValue('https://storage/doc.pdf')
  mocks.ultimasImpresiones.mockResolvedValue({})
  mocks.registrarImpresion.mockResolvedValue({ id: 'i-1', documento_id: 'd-1', reimpresion: false })
})

const impresion = (tipo: 'factura' | 'remito', impreso_en: string) => ({
  id: `i-${tipo}`, comprobante_id: 'k-1', empresa_id: 'e-1', tipo_documento: tipo, documento_id: 'd-1',
  impreso_por: 'u-1', impreso_en, reimpresion: false,
})

describe('DocumentosComprobante · marca de impreso (F-VTA-21)', () => {
  it('muestra la marca con fecha y hora de la última impresión y la casilla vacía si nunca se imprimió (FR-033)', async () => {
    mocks.ultimasImpresiones.mockResolvedValue({ factura: impresion('factura', '2026-10-07T14:42:00Z') })
    render(<Pantalla c={comprobante()} empresa="e-1" />)

    expect(await screen.findByText('Factura impresa · 07/10 11:42')).toBeInTheDocument()
    expect(screen.getByText('Remito impreso')).toBeInTheDocument()
    expect(mocks.ultimasImpresiones).toHaveBeenCalledWith('k-1')
  })

  it('sin impresiones muestra todas las marcas vacías (FR-033)', async () => {
    render(<Pantalla c={comprobante()} empresa="e-1" />)
    expect(await screen.findByText('Factura impresa')).toBeInTheDocument()
    expect(screen.getByText('Remito impreso')).toBeInTheDocument()
    await waitFor(() => expect(mocks.ultimasImpresiones).toHaveBeenCalled())
  })

  it('tras reimprimir actualiza la marca con la última fecha y hora (FR-033, FR-035)', async () => {
    mocks.ultimasImpresiones
      .mockResolvedValueOnce({ remito: impresion('remito', '2026-10-07T14:42:00Z') })
      .mockResolvedValueOnce({ remito: impresion('remito', '2026-10-08T12:05:00Z') })
    mocks.solicitarDocumento.mockResolvedValue(generado)
    render(<Pantalla c={comprobante()} empresa="e-1" />)
    expect(await screen.findByText('Remito impreso · 07/10 11:42')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir remito' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Imprimir comprobante' })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Imprimir' }))

    expect(await screen.findByText('Remito impreso · 08/10 09:05')).toBeInTheDocument()
    expect(mocks.registrarImpresion).toHaveBeenCalledWith('d-1')
    expect(mocks.ultimasImpresiones).toHaveBeenCalledTimes(2)
  })

  it('si no se pueden leer las marcas lo avisa en vez de mostrar casillas vacías engañosas', async () => {
    mocks.ultimasImpresiones.mockRejectedValue(new Error('sin red'))
    render(<Pantalla c={comprobante()} empresa="e-1" />)
    expect(await screen.findByText('No pudimos cargar las marcas de impreso.')).toBeInTheDocument()
  })

  it('al cambiar de empresa vuelve a leer las marcas y descarta las de la anterior (Principio VIII)', async () => {
    mocks.ultimasImpresiones
      .mockResolvedValueOnce({ factura: impresion('factura', '2026-10-07T14:42:00Z') })
      .mockResolvedValueOnce({})
    const { rerender } = render(<Pantalla c={comprobante()} empresa="e-1" />)
    expect(await screen.findByText('Factura impresa · 07/10 11:42')).toBeInTheDocument()

    await act(async () => {
      rerender(<Pantalla c={comprobante()} empresa="e-2" />)
    })
    await waitFor(() => expect(mocks.ultimasImpresiones).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/Factura impresa · /)).not.toBeInTheDocument()
  })

  it('una factura sin confirmar no muestra marcas ni las consulta', () => {
    render(<Pantalla c={comprobante({ estado: 'borrador' })} empresa="e-1" />)
    expect(screen.queryByText('Factura impresa')).not.toBeInTheDocument()
    expect(mocks.ultimasImpresiones).not.toHaveBeenCalled()
  })
})

describe('DocumentosComprobante (F-VTA-19)', () => {
  it('una factura confirmada ofrece «Imprimir remito», que abre el diálogo con el remito elegido (FR-012)', async () => {
    render(<Pantalla c={comprobante()} empresa="e-1" />)
    expect(screen.getByRole('heading', { name: 'Documentos' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir remito' }))
    expect(await screen.findByRole('dialog', { name: 'Imprimir comprobante' })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Remito/ })).toBeChecked()
  })

  it('tras imprimir cierra el diálogo y confirma con «Enviado a imprimir»', async () => {
    mocks.solicitarDocumento.mockResolvedValue(generado)
    render(<Pantalla c={comprobante()} empresa="e-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir remito' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Imprimir', hidden: false }))
    expect(await screen.findByText('Enviado a imprimir')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.solicitarDocumento).toHaveBeenCalledWith('k-1', 'remito')
  })

  it('una factura sin confirmar no ofrece imprimir y explica el motivo', () => {
    render(<Pantalla c={comprobante({ estado: 'borrador' })} empresa="e-1" />)
    expect(screen.queryByRole('button', { name: 'Imprimir remito' })).not.toBeInTheDocument()
    expect(screen.getByText('La factura tiene que estar confirmada para imprimirla.')).toBeInTheDocument()
  })

  it('sin acceso a Ventas no se ofrece imprimir ni se muestra motivo', () => {
    render(<Pantalla c={comprobante()} puedeImprimir={false} empresa="e-1" />)
    expect(screen.queryByRole('button', { name: 'Imprimir remito' })).not.toBeInTheDocument()
    expect(screen.queryByText(/tiene que estar confirmada/)).not.toBeInTheDocument()
  })

  it('al cambiar la empresa activa con el diálogo abierto lo cierra con aviso y no imprime (FR-014)', async () => {
    const { rerender } = render(<Pantalla c={comprobante()} empresa="e-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir remito' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      rerender(<Pantalla c={comprobante()} empresa="e-2" />)
    })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(AVISO_CAMBIO_DE_TIENDA)).toBeInTheDocument()
    expect(mocks.solicitarDocumento).not.toHaveBeenCalled()
  })

  it('un cambio de empresa con el diálogo cerrado no muestra aviso', async () => {
    const { rerender } = render(<Pantalla c={comprobante()} empresa="e-1" />)
    await act(async () => {
      rerender(<Pantalla c={comprobante()} empresa="e-2" />)
    })
    expect(screen.queryByText(AVISO_CAMBIO_DE_TIENDA)).not.toBeInTheDocument()
  })
})
