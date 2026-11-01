import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  reingresarPorGarantia: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../lib/reparacionGarantia', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/reparacionGarantia')>()),
  reingresarPorGarantia: mocks.reingresarPorGarantia,
}))

import { hoyEnArgentina, type Reparacion, type Tecnico } from '../../lib/reparaciones'
import { ReingresoGarantiaDialog } from './ReingresoGarantiaDialog'

const REPARACION: Reparacion = {
  id: 'r-1', numero: 1, codigo: 'R-0001', empresa_id: 'e-1', empresa: 'San Javucho', cliente_id: 'c-1',
  cliente: 'Distribuidora Norte', contacto: 'Ana 11-5555', modelo_id: 'm-1', equipo: 'Nintendo Switch',
  modelo: 'Estándar', estado_id: 's-1', estado: 'Recibido', estado_cierra: false, estado_tono: 'neutral',
  numero_serie: 'SN-123', accesorios: 'Cargador', falla: 'No enciende', puede_ver_costos: false,
  costo_mano_obra: null, costo_repuestos: null, tecnico_id: null, ingreso_en: '2026-10-01',
  entrega_prevista: null, entrega_real: '2026-10-05', entregado_por: 'Ana', anulada_en: null,
  anulada_motivo: null, updated_at: '2026-10-05T10:00:00Z',
  items: [], total_mano_obra: 0, total_repuestos: 0, total_cliente: 0, ganancia_estimada: null,
}

const TECNICOS: Tecnico[] = [
  { user_id: 'u-1', nombre: 'Lucía Gómez' },
  { user_id: 'u-2', nombre: 'Juan Pérez' },
]

const NUEVA: Reparacion = { ...REPARACION, id: 'r-2', numero: 2, codigo: 'R-0002', ingreso_en: hoyEnArgentina() }

type Props = React.ComponentProps<typeof ReingresoGarantiaDialog>

function montar(props: Partial<Props> = {}) {
  const onReingresada = vi.fn()
  const onCerrar = vi.fn()
  const onCambioEmpresa = vi.fn()
  const resultado = render(
    <ReingresoGarantiaDialog
      abierto
      reparacion={REPARACION}
      tecnicos={TECNICOS}
      empresaActivaId="e-1"
      onCerrar={onCerrar}
      onCambioEmpresa={onCambioEmpresa}
      onReingresada={onReingresada}
      {...props}
    />,
  )
  return { ...resultado, onReingresada, onCerrar, onCambioEmpresa }
}

describe('ReingresoGarantiaDialog (FR-022, FR-024)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.reingresarPorGarantia.mockResolvedValue(NUEVA)
  })

  it('muestra el resumen del equipo en solo lectura', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')
    const resumen = within(dialogo).getByLabelText('Resumen del equipo')
    expect(resumen).toHaveTextContent('R-0001')
    expect(resumen).toHaveTextContent('Distribuidora Norte')
    expect(resumen).toHaveTextContent('Nintendo Switch Estándar')
    expect(resumen).toHaveTextContent('SN-123')
    expect(resumen).toHaveTextContent('Cargador')
    // El resumen no es un formulario: no hay campos editables de equipo.
    expect(within(resumen).queryByRole('textbox')).toBeNull()
    expect(within(resumen).queryByRole('combobox')).toBeNull()
  })

  it('la falla del reingreso es obligatoria: avisa, no llama a la base y lleva el foco al campo', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    expect(await within(dialogo).findByText('Describí la falla del reingreso')).toBeInTheDocument()
    expect(mocks.reingresarPorGarantia).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(within(dialogo).getByLabelText(/Falla del reingreso/)))
  })

  it('rechaza una entrega prevista anterior al ingreso de hoy', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Entrega prevista/), { target: { value: '2000-01-01' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    expect(await within(dialogo).findByText('La entrega prevista no puede ser anterior al ingreso')).toBeInTheDocument()
    expect(mocks.reingresarPorGarantia).not.toHaveBeenCalled()
  })

  it('reingresa con la falla, el técnico y la entrega prevista, y devuelve la reparación nueva', async () => {
    const { onReingresada } = montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Falla del reingreso/), { target: { value: '  Se apaga sola  ' } })
    fireEvent.mouseDown(within(dialogo).getByLabelText('Técnico'))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Lucía Gómez' }))
    fireEvent.change(within(dialogo).getByLabelText(/Entrega prevista/), { target: { value: '2030-01-10' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    await waitFor(() => expect(mocks.reingresarPorGarantia).toHaveBeenCalledWith('r-1', {
      falla: '  Se apaga sola  ', tecnico: 'u-1', entrega_prevista: '2030-01-10',
    }))
    expect(onReingresada).toHaveBeenCalledWith(NUEVA)
  })

  it('el técnico y la entrega prevista son opcionales', async () => {
    montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Falla del reingreso/), { target: { value: 'Falla' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    await waitFor(() => expect(mocks.reingresarPorGarantia).toHaveBeenCalledWith('r-1', {
      falla: 'Falla', tecnico: '', entrega_prevista: '',
    }))
  })

  it('un error de campo de la base se muestra en ese campo', async () => {
    mocks.reingresarPorGarantia.mockRejectedValueOnce({
      code: '22023', hint: 'falla', message: 'Máximo 1000 caracteres',
    })
    montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Falla del reingreso/), { target: { value: 'Falla' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    expect(await within(dialogo).findByText('Máximo 1000 caracteres')).toBeInTheDocument()
    expect(dialogo).toBeInTheDocument()
  })

  it('un error general de la base se muestra en el diálogo y no cierra', async () => {
    mocks.reingresarPorGarantia.mockRejectedValueOnce({ code: '55000' })
    montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.change(within(dialogo).getByLabelText(/Falla del reingreso/), { target: { value: 'Falla' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Reingresar' }))
    expect(await within(dialogo).findByText(/Solo se puede reingresar por garantía una reparación entregada/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Reingresar' })).toBeInTheDocument()
  })

  it('«Cancelar» cierra sin reingresar', async () => {
    const { onCerrar } = montar()
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
    expect(onCerrar).toHaveBeenCalled()
    expect(mocks.reingresarPorGarantia).not.toHaveBeenCalled()
  })

  it('si cambia la empresa activa con el diálogo abierto, avisa para cerrarlo (Principio VIII)', async () => {
    const { onCambioEmpresa, rerender } = montar()
    await screen.findByRole('dialog')
    expect(onCambioEmpresa).not.toHaveBeenCalled()
    rerender(
      <ReingresoGarantiaDialog
        abierto
        reparacion={REPARACION}
        tecnicos={TECNICOS}
        empresaActivaId="e-2"
        onCerrar={() => undefined}
        onCambioEmpresa={onCambioEmpresa}
        onReingresada={() => undefined}
      />,
    )
    await waitFor(() => expect(onCambioEmpresa).toHaveBeenCalled())
  })
})
