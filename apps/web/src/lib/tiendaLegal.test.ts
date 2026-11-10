import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: (...args: unknown[]) => mocks.rpc(nombre, ...args) }) },
}))

import { cuitParaMostrar, esUrlHttps, leerLegalTienda, legalTieneDatos, useLegalTienda } from './tiendaLegal'

beforeEach(() => mocks.rpc.mockReset())

describe('cuitParaMostrar', () => {
  it('formatea 11 dígitos como XX-XXXXXXXX-X, deja otros valores y omite el vacío', () => {
    expect(cuitParaMostrar('30711111114')).toBe('30-71111111-4')
    expect(cuitParaMostrar('123')).toBe('123')
    expect(cuitParaMostrar('  ')).toBeNull()
    expect(cuitParaMostrar(null)).toBeNull()
  })
})

// Armado por partes para no disparar la regla no-script-url del lint.
const ESQUEMA_SCRIPT = ['java', 'script:alert(1)'].join('')

describe('esUrlHttps', () => {
  it('solo acepta https', () => {
    expect(esUrlHttps('https://ejemplo.com/legal')).toBe(true)
    expect(esUrlHttps('http://ejemplo.com')).toBe(false)
    expect(esUrlHttps(ESQUEMA_SCRIPT)).toBe(false)
    expect(esUrlHttps('no es una url')).toBe(false)
  })
})

describe('leerLegalTienda (FR-031, FR-032)', () => {
  it('llama a publico.legal_por_dominio y mapea los campos', async () => {
    mocks.rpc.mockResolvedValue({
      data: { razon_social: ' Uno A S.A. ', cuit: '30711111114', direccion: null, enlaces: [{ titulo: 'Términos', url: 'https://uno.ejemplo.com/t' }] },
      error: null,
    })
    expect(await leerLegalTienda('uno.ejemplo.com')).toEqual({
      razonSocial: 'Uno A S.A.',
      cuit: '30711111114',
      direccion: null,
      enlaces: [{ titulo: 'Términos', url: 'https://uno.ejemplo.com/t' }],
    })
    expect(mocks.rpc).toHaveBeenCalledWith('publico', 'legal_por_dominio', { host: 'uno.ejemplo.com' })
  })

  it('descarta los enlaces que no son https o no tienen título', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        razon_social: null, cuit: null, direccion: null,
        enlaces: [
          { titulo: 'Malo', url: ESQUEMA_SCRIPT },
          { titulo: 'Http', url: 'http://x.ejemplo.com' },
          { titulo: ' ', url: 'https://x.ejemplo.com' },
          { titulo: 'Bueno', url: 'https://x.ejemplo.com' },
        ],
      },
      error: null,
    })
    expect((await leerLegalTienda('uno.ejemplo.com'))?.enlaces).toEqual([{ titulo: 'Bueno', url: 'https://x.ejemplo.com' }])
  })

  it('devuelve null para tienda desconocida o desactivada y propaga el error', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await leerLegalTienda('no.ejemplo.com')).toBeNull()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(leerLegalTienda('uno.ejemplo.com')).rejects.toThrow('boom')
  })
})

describe('legalTieneDatos', () => {
  it('es falso sin ningún dato y verdadero con cualquiera', () => {
    expect(legalTieneDatos(null)).toBe(false)
    expect(legalTieneDatos({ razonSocial: null, cuit: null, direccion: null, enlaces: [] })).toBe(false)
    expect(legalTieneDatos({ razonSocial: null, cuit: null, direccion: 'Calle 1', enlaces: [] })).toBe(true)
  })
})

describe('useLegalTienda', () => {
  it('devuelve los datos del host y null si la carga falla', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { razon_social: 'Uno', cuit: null, direccion: null, enlaces: [] }, error: null })
    const { result, rerender } = renderHook(({ host }) => useLegalTienda(host), { initialProps: { host: 'uno.ejemplo.com' } })
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current?.razonSocial).toBe('Uno'))

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'caída' } })
    rerender({ host: 'dos.ejemplo.com' })
    // Al cambiar de host no se muestran los datos del anterior.
    expect(result.current).toBeNull()
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2))
    expect(result.current).toBeNull()
  })
})
