import { fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())
vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>()
  return { ...actual, supabaseClient: { ...actual.supabaseClient, rpc, from } }
})

import { AYUDA_POR_DESTINO } from '../../ayuda/contenidos'
import { TEXTO_SIN_AYUDA } from '../../ayuda/resolverAyuda'
import { PanelAyuda } from './PanelAyuda'

const en = (ruta: string) => render(<MemoryRouter initialEntries={[ruta]}><PanelAyuda /></MemoryRouter>)

describe('PanelAyuda (FR-020, FR-021, FR-026, FR-027)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('muestra el botón «Ayuda» y el panel está cerrado', () => {
    en('/stock')
    expect(screen.getByRole('button', { name: 'Ayuda' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('al pulsarlo abre la ayuda de la pantalla actual: título, resumen y pasos', () => {
    en('/stock/movimientos')
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    const dialogo = screen.getByRole('dialog', { name: 'Movimientos' })
    const c = AYUDA_POR_DESTINO['stock-movimientos']
    expect(c).toBeDefined()
    expect(dialogo).toHaveTextContent(c.resumen)
    for (const paso of c.pasos ?? []) expect(dialogo).toHaveTextContent(paso)
  })

  it('tres pantallas distintas abren textos distintos (SC-003): cada una muestra SU resumen', () => {
    const casos = [['/categorias', 'categorias'], ['/ventas/comprobantes', 'ventas-comprobantes'], ['/usuarios', 'usuarios']] as const
    const resumenes = casos.map(([ruta, id]) => {
      const { unmount } = en(ruta)
      fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
      const resumen = AYUDA_POR_DESTINO[id].resumen
      expect(screen.getByRole('dialog')).toHaveTextContent(resumen)
      unmount()
      return resumen
    })
    expect(new Set(resumenes).size).toBe(3)
  })

  it('una subruta (ficha) muestra la ayuda de su destino padre', () => {
    en('/clientes/123/editar')
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    expect(screen.getByRole('dialog', { name: 'Clientes' })).toBeInTheDocument()
  })

  it('una ruta sin destino muestra «Esta pantalla todavía no tiene ayuda» (FR-025)', () => {
    en('/ruta-que-no-existe')
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    expect(screen.getByRole('dialog', { name: 'Ayuda' })).toHaveTextContent(TEXTO_SIN_AYUDA)
  })

  it('se cierra con «Cerrar» y con Escape, y devuelve el foco al botón (FR-026)', async () => {
    en('/stock')
    const boton = screen.getByRole('button', { name: 'Ayuda' })
    boton.focus()
    fireEvent.click(boton)
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(boton).toHaveFocus()

    fireEvent.click(boton)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(boton).toHaveFocus()
  })

  it('abrir la ayuda NO consulta datos (FR-027): ni rpc ni tablas', () => {
    en('/ventas/pagos')
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('el panel abierto no tiene violaciones de accesibilidad (axe)', async () => {
    en('/stock')
    fireEvent.click(screen.getByRole('button', { name: 'Ayuda' }))
    const resultado = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } } })
    expect(resultado.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
