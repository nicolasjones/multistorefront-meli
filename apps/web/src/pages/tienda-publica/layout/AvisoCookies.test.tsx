import { createTheme } from '@mui/material'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { violacionesAxe } from '../../../test/axe'
import { beforeEach, describe, expect, it } from 'vitest'
import { guardarConsentimiento, leerConsentimiento, reiniciarConsentimientoEnMemoria } from '../../../lib/consentimientoCookies'
import AvisoCookies from './AvisoCookies'

beforeEach(() => {
  window.localStorage.clear()
  reiniciarConsentimientoEnMemoria()
})

describe('AvisoCookies (FR-033)', () => {
  it('es una región con nombre accesible, con «Aceptar» y «Rechazar», sin robar el foco', async () => {
    const { container } = render(<AvisoCookies />)
    expect(screen.getByRole('region', { name: 'Aviso de cookies' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument()
    expect(document.body).toHaveFocus()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('queda por debajo de los paneles laterales (Drawer): en el celular no tapa sus botones de abajo', () => {
    render(<AvisoCookies />)
    const aviso = screen.getByRole('region', { name: 'Aviso de cookies' })
    // Menú y filtros del celular son `Drawer` temporales (`zIndex.drawer`); el aviso queda estrictamente debajo.
    expect(Number(getComputedStyle(aviso).zIndex)).toBeLessThan(createTheme().zIndex.drawer)
  })

  it('avisa que se mide con Google Analytics y Meta y que no se envían datos personales', () => {
    render(<AvisoCookies />)
    const aviso = screen.getByRole('region', { name: 'Aviso de cookies' })
    expect(aviso).toHaveTextContent(/Google Analytics y\s+Meta/)
    expect(aviso).toHaveTextContent(/No enviamos tus datos personales/)
  })

  it('«Aceptar» guarda la decisión y el aviso desaparece', () => {
    render(<AvisoCookies />)
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar' }))
    expect(leerConsentimiento()).toBe('aceptadas')
    expect(screen.queryByRole('region', { name: 'Aviso de cookies' })).not.toBeInTheDocument()
  })

  it('«Rechazar» es un botón nativo (operable con teclado), guarda y no vuelve al montar de nuevo', () => {
    const { unmount } = render(<AvisoCookies />)
    const rechazar = screen.getByRole('button', { name: 'Rechazar' })
    expect(rechazar.tagName).toBe('BUTTON')
    expect(rechazar).toHaveProperty('tabIndex', 0)
    fireEvent.click(rechazar)
    expect(leerConsentimiento()).toBe('rechazadas')
    unmount()
    render(<AvisoCookies />)
    expect(screen.queryByRole('region', { name: 'Aviso de cookies' })).not.toBeInTheDocument()
  })

  it('no aparece si ya había una decisión y se cierra si se decide desde otro lado', () => {
    render(<AvisoCookies />)
    expect(screen.getByRole('region', { name: 'Aviso de cookies' })).toBeInTheDocument()
    act(() => guardarConsentimiento('aceptadas'))
    expect(screen.queryByRole('region', { name: 'Aviso de cookies' })).not.toBeInTheDocument()
  })
})
