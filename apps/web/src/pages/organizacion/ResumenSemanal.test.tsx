import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', () => ({ supabaseClient: { rpc } }))

import { textoProximoEnvio, textoUltimoResumen } from '../../lib/resumenSemanal'
import { ResumenSemanalOrganizacion } from './ResumenSemanal'

const estado = (extra: Record<string, unknown> = {}) => ({
  activo: true,
  proximo_envio: '2027-03-22T11:00:00Z',
  ultima_semana_desde: '2027-03-08',
  ultimo_estado: 'enviado',
  destinatarios: 2,
  ...extra,
})

describe('Resumen semanal por correo en Mi organización (F-REP-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpc.mockImplementation(async (nombre: string) => (
      nombre === 'estado_resumen_semanal' ? { data: [estado()], error: null } : { data: true, error: null }
    ))
  })

  it('muestra el estado, el próximo envío en hora de Buenos Aires y el último resumen', async () => {
    render(<ResumenSemanalOrganizacion />)
    expect(await screen.findByRole('checkbox', { name: 'Resumen semanal activo' })).toBeChecked()
    expect(screen.getByText(/Próximo envío: lunes, 22 de marzo, 08:00, a 2 administradores/)).toBeInTheDocument()
    expect(screen.getByText('Último resumen (semana del 8 de marzo): se envió.')).toBeInTheDocument()
    expect(screen.getByText(/cada lunes a las 08:00 \(hora de Buenos Aires\)/)).toBeInTheDocument()
  })

  it('pausar llama a la RPC de configuración y recarga el estado', async () => {
    render(<ResumenSemanalOrganizacion />)
    const interruptor = await screen.findByRole('checkbox', { name: 'Resumen semanal activo' })
    rpc.mockImplementation(async (nombre: string) => (
      nombre === 'estado_resumen_semanal' ? { data: [estado({ activo: false })], error: null } : { data: false, error: null }
    ))
    fireEvent.click(interruptor)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('configurar_resumen_semanal', { p_activo: false }))
    expect(await screen.findByRole('checkbox', { name: 'Resumen semanal pausado' })).not.toBeChecked()
    expect(screen.getByText('No se envía ningún resumen hasta que lo reactives.')).toBeInTheDocument()
  })

  it('si la base rechaza el cambio lo dice y no cambia el estado', async () => {
    render(<ResumenSemanalOrganizacion />)
    const interruptor = await screen.findByRole('checkbox', { name: 'Resumen semanal activo' })
    rpc.mockImplementation(async (nombre: string) => (
      nombre === 'estado_resumen_semanal' ? { data: [estado()], error: null } : { data: null, error: { message: 'x' } }
    ))
    fireEvent.click(interruptor)
    expect(await screen.findByText('No se guardó el cambio.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Resumen semanal activo' })).toBeChecked()
  })

  it('un error al cargar ofrece reintentar', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    render(<ResumenSemanalOrganizacion />)
    expect(await screen.findByText('No pudimos cargar el estado del resumen semanal.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('checkbox', { name: 'Resumen semanal activo' })).toBeInTheDocument()
  })

  it('no tiene violaciones de axe', async () => {
    const { container } = render(<ResumenSemanalOrganizacion />)
    await screen.findByRole('checkbox', { name: 'Resumen semanal activo' })
    const { violations } = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(violations.map((v) => v.id)).toEqual([])
  })

  it('los textos auxiliares cubren cada estado del último resumen', () => {
    expect(textoUltimoResumen(estado({ ultima_semana_desde: null, ultimo_estado: null }) as never)).toBe('Todavía no se envió ningún resumen.')
    expect(textoUltimoResumen(estado({ ultimo_estado: 'fallido' }) as never)).toContain('no se pudo enviar')
    expect(textoUltimoResumen(estado({ ultimo_estado: 'sin_destinatario' }) as never)).toContain('no había administradores')
    expect(textoProximoEnvio('no-es-fecha')).toBe('')
  })
})
