import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ solicitarDocumento: vi.fn(), esperarDocumento: vi.fn(), urlFirmadaDocumento: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
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
