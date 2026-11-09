import { fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notificacion, simularRpc as simular } from './pruebas-notificaciones'

const rpc = vi.hoisted(() => vi.fn())
const simularRpc = (o: Parameters<typeof simular>[1] = {}) => simular(rpc, o)

vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc } }
})

import { CampanitaNotificaciones } from './CampanitaNotificaciones'

describe('CampanitaNotificaciones · accesibilidad (FR-011)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('se opera con teclado, Escape cierra y devuelve el foco al botón', async () => {
    simularRpc({ sinLeer: 1, items: [notificacion(1)] })
    render(<CampanitaNotificaciones />)
    const boton = await screen.findByRole('button', { name: 'Notificaciones, 1 sin leer' })
    boton.focus()
    fireEvent.click(boton)
    expect(await screen.findByRole('dialog', { name: 'Notificaciones' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Notificaciones' }), { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notificaciones' })).toBeNull())
    expect(boton).toHaveFocus()
  })

  it('el desplegable abierto no tiene violaciones críticas de axe', async () => {
    simularRpc({ sinLeer: 1, items: [notificacion(1), notificacion(2, { leido_en: new Date().toISOString() })] })
    render(<CampanitaNotificaciones />)
    fireEvent.click(await screen.findByRole('button', { name: /Notificaciones/ }))
    await screen.findByText('2 notificaciones')
    const { violations } = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(violations.map((v) => v.id)).toEqual([])
  })
})
