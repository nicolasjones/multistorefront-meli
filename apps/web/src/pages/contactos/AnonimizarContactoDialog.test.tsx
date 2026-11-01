import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  anonimizarContacto: vi.fn(),
  useEmpresaActivaCambio: vi.fn(),
  onCerrar: vi.fn(),
  onAnonimizado: vi.fn(),
  onRecargar: vi.fn(),
}))

vi.mock('../../hooks/useContactos', () => ({
  useEmpresaActivaCambio: mocks.useEmpresaActivaCambio,
  AVISO_CAMBIO_EMPRESA: 'aviso de cambio',
}))
vi.mock('../../lib/contactos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/contactos')>()),
  anonimizarContacto: mocks.anonimizarContacto,
}))

import { ErrorContacto } from '../../lib/contactos'
import { AnonimizarContactoDialog } from './AnonimizarContactoDialog'

const abrir = () =>
  render(
    <AnonimizarContactoDialog
      contactoId="k-1" actualizadoEn="2026-10-23T11:48:00.000Z"
      onCerrar={mocks.onCerrar} onAnonimizado={mocks.onAnonimizado} onRecargar={mocks.onRecargar}
    />,
  )

describe('AnonimizarContactoDialog (F-CON-05, FR-010)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useEmpresaActivaCambio.mockReturnValue(false)
    mocks.anonimizarContacto.mockResolvedValue(undefined)
  })

  it('explica qué se borra y que no se deshace', () => {
    abrir()
    expect(screen.getByText('Esta acción no se puede deshacer.')).toBeInTheDocument()
    expect(screen.getByText(/Se conservan las consultas y las compras/)).toBeInTheDocument()
  })

  it('confirmar anonimiza con el sello vigente', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Anonimizar' }))
    await waitFor(() => expect(mocks.onAnonimizado).toHaveBeenCalled())
    expect(mocks.anonimizarContacto).toHaveBeenCalledWith('k-1', '2026-10-23T11:48:00.000Z')
  })

  it('un conflicto de edición ofrece recargar', async () => {
    mocks.anonimizarContacto.mockRejectedValue(new ErrorContacto('x', '40001'))
    abrir()
    fireEvent.click(screen.getByRole('button', { name: 'Anonimizar' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Recargar' }))
    expect(mocks.onRecargar).toHaveBeenCalled()
    expect(mocks.onAnonimizado).not.toHaveBeenCalled()
  })

  it('se cierra con aviso si cambia la empresa activa', () => {
    mocks.useEmpresaActivaCambio.mockReturnValue(true)
    abrir()
    expect(mocks.onCerrar).toHaveBeenCalledWith('aviso de cambio')
  })
})
