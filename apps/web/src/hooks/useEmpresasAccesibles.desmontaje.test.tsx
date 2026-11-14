import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { listar } = vi.hoisted(() => ({ listar: vi.fn() }))
vi.mock('../lib/empresaActiva', () => ({ listarEmpresasSelector: listar }))
vi.mock('./useOrganizacionActiva', () => ({ useOrganizacionActiva: () => ({ organizacionActiva: { id: 'org-1' } }) }))

import { useEmpresasAccesibles } from './useEmpresasAccesibles'

describe('useEmpresasAccesibles — desmontaje [MSF-808]', () => {
  afterEach(() => vi.unstubAllGlobals())

  // Reproduce el fallo del CI: tras destruirse el entorno, un setState hace que React
  // lea `window` y lance ReferenceError. Sin la guarda, `refetch()` rechaza.
  it.each([
    ['resuelve', (r: (v: unknown[]) => void) => r([{ id: 'e1', esActiva: true }])],
    ['rechaza', (_r: (v: unknown[]) => void, x: (e: unknown) => void) => x(new Error('boom'))],
  ])('no toca el estado si la petición %s tras desmontar', async (_n, terminar) => {
    let resolver!: (v: unknown[]) => void
    let rechazar!: (e: unknown) => void
    listar.mockReturnValue(new Promise((res, rej) => ((resolver = res), (rechazar = rej))))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useEmpresasAccesibles())
    const enVuelo = result.current.refetch()
    unmount()
    vi.stubGlobal('window', undefined)
    terminar(resolver, rechazar)
    await expect(enVuelo).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })
})
