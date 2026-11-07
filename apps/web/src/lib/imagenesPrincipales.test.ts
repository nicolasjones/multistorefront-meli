import { describe, expect, it, vi } from 'vitest'
import { consultarImagenesPrincipales } from './imagenesPrincipales'

const cliente = (filas: unknown[], firmadas: Array<{ path: string; signedUrl: string }>) => {
  const returns = vi.fn().mockResolvedValue({ data: filas, error: null })
  const cadena = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), returns }
  const createSignedUrls = vi.fn().mockResolvedValue({ data: firmadas, error: null })
  return {
    cliente: { schema: vi.fn(() => ({ from: vi.fn(() => cadena) })), storage: { from: vi.fn(() => ({ createSignedUrls })) } } as never,
    cadena,
    createSignedUrls,
  }
}

describe('consultarImagenesPrincipales', () => {
  it('sin ids no consulta', async () => {
    const { cliente: c, cadena } = cliente([], [])
    expect((await consultarImagenesPrincipales(c, ['', ''])).size).toBe(0)
    expect(cadena.select).not.toHaveBeenCalled()
  })

  it('toma la imagen de menor posición de cada producto y la firma', async () => {
    const { cliente: c, createSignedUrls } = cliente(
      [
        { producto_id: 'p1', ruta: 'o/p1/frente.png', posicion: 1 },
        { producto_id: 'p1', ruta: 'o/p1/lado.png', posicion: 2 },
        { producto_id: 'p2', ruta: 'o/p2/uno.png', posicion: 1 },
      ],
      [
        { path: 'o/p1/frente.png', signedUrl: 'https://firmada/p1' },
        { path: 'o/p2/uno.png', signedUrl: 'https://firmada/p2' },
      ],
    )
    const urls = await consultarImagenesPrincipales(c, ['p1', 'p2', 'p1', 'p3'])
    expect(urls.get('p1')).toBe('https://firmada/p1')
    expect(urls.get('p2')).toBe('https://firmada/p2')
    expect(urls.has('p3')).toBe(false)
    expect(createSignedUrls.mock.calls[0][0]).toEqual(['o/p1/frente.png', 'o/p2/uno.png'])
  })
})
