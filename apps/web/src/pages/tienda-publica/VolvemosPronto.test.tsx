import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../test/axe'

vi.mock('../../lib/supabase', () => ({
  supabaseClient: { storage: { from: () => ({ getPublicUrl: (ruta: string) => ({ data: { publicUrl: `https://cdn.test/${ruta}` } }) }) } },
}))

import { VolvemosPronto } from './VolvemosPronto'

const MARCA = {
  nombre: 'Mundo JC', colorPrimario: '#AA1111', colorPrimarioOscuro: '#000000', colorAcento: '#222222', colorFondo: '#FAF7F0',
  tipografiaTitulos: 'Playfair Display', tipografiaTexto: 'Lato', logoRuta: 'org/emp/logo.png',
}

// F-TDA-19 (FR-002, FR-005, SC-001): «Volvemos pronto» con la marca de la tienda pausada y genérica
// para un dominio desconocido, sin enlaces al catálogo ni contacto.
describe('VolvemosPronto (FR-002)', () => {
  it('con marca muestra el logo, el nombre comercial y el texto de siempre', () => {
    const { container } = render(<VolvemosPronto marca={MARCA} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Volvemos pronto' })).toBeInTheDocument()
    expect(screen.getByText('Mundo JC')).toBeInTheDocument()
    expect(screen.getByText('Estamos preparando esta tienda. Volvé a visitarnos en un rato.')).toBeInTheDocument()
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.test/org/emp/logo.png')
    expect(screen.getByTestId('volvemos-pronto-marca')).toBeInTheDocument()
  })

  it('sin logo muestra el nombre en su lugar', () => {
    const { container } = render(<VolvemosPronto marca={{ ...MARCA, logoRuta: null }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Mundo JC')).toBeInTheDocument()
  })

  it('carga las tipografías de la tienda y las quita al salir', () => {
    const { unmount } = render(<VolvemosPronto marca={MARCA} />)
    const enlace = document.head.querySelector('link[data-tienda-fuentes]')
    expect(enlace?.getAttribute('href')).toContain('Playfair+Display')
    unmount()
    expect(document.head.querySelector('link[data-tienda-fuentes]')).toBeNull()
  })

  it('genérica: sin marca no muestra nombre, logo ni tipografías', () => {
    const { container } = render(<VolvemosPronto />)
    expect(screen.getByTestId('volvemos-pronto-generica')).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText('Mundo JC')).not.toBeInTheDocument()
    expect(document.head.querySelector('link[data-tienda-fuentes]')).toBeNull()
  })

  it.each([['con marca', MARCA], ['genérica', undefined]])('%s: sin enlaces ni botones (no lleva al catálogo ni al contacto)', (_nombre, marca) => {
    render(<VolvemosPronto marca={marca} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([['con marca', MARCA], ['con marca sin logo', { ...MARCA, logoRuta: null }], ['genérica', undefined]])('%s: sin violaciones de accesibilidad', async (_nombre, marca) => {
    const { container } = render(<VolvemosPronto marca={marca} />)
    expect(await violacionesAxe(container)).toEqual([])
  })
})
