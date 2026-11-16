import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../../lib/supabase', () => ({
  supabaseClient: { schema: (nombre: string) => ({ rpc: nombre === 'publico' ? mocks.rpc : vi.fn() }) },
}))

import { useContactoWhatsapp } from './useContactoWhatsapp'

const HOST = 'mundojc.localhost'
const NUMERO = '+54 9 11 7365-2596'
const DIGITOS = '5491173652596'

function contacto(nombre: string, whatsapp: string | null) {
  return { data: { nombre, whatsapp }, error: null }
}

// F-TDA-14 (FR-020, FR-021, FR-060): el contacto sale de `publico.contacto_por_dominio` para el host de
// la tienda; sin número válido no hay botón y al cambiar de tienda nunca se muestra el contacto anterior.
describe('useContactoWhatsapp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rpc.mockResolvedValue(contacto('Mundo JC', NUMERO))
  })

  it('consulta la función pública para el host y arranca en carga', () => {
    mocks.rpc.mockReturnValue(new Promise(() => undefined))
    const { result } = renderHook(() => useContactoWhatsapp(HOST))
    expect(result.current).toEqual({ fase: 'cargando' })
    expect(mocks.rpc).toHaveBeenCalledWith('contacto_por_dominio', { host: HOST })
  })

  it('con número válido queda listo con el número como lo cargó la empresa y sus dígitos', async () => {
    const { result } = renderHook(() => useContactoWhatsapp(HOST))
    await waitFor(() => expect(result.current.fase).toBe('listo'))
    expect(result.current).toEqual({
      fase: 'listo',
      contacto: { nombre: 'Mundo JC', numero: NUMERO, digitos: DIGITOS },
    })
  })

  it.each([[null], ['1234567'], ['']])('sin número válido (%s) queda sin número', async (whatsapp) => {
    mocks.rpc.mockResolvedValue(contacto('Mundo JC', whatsapp as string | null))
    const { result } = renderHook(() => useContactoWhatsapp(HOST))
    await waitFor(() => expect(result.current.fase).toBe('sin-numero'))
  })

  it('host desconocido o empresa desactivada (sin fila) queda sin contacto', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useContactoWhatsapp('no-existe.localhost'))
    await waitFor(() => expect(result.current.fase).toBe('sin-contacto'))
  })

  it('una falla de lectura no lanza: queda en error y se anota en la consola', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'detalle interno' } })
    const { result } = renderHook(() => useContactoWhatsapp(HOST))
    await waitFor(() => expect(result.current.fase).toBe('error'))
    expect(consola).toHaveBeenCalled()
    consola.mockRestore()
  })

  it('al cambiar de host descarta la respuesta que llega tarde de la tienda anterior', async () => {
    let resolverPrimera: (valor: unknown) => void = () => undefined
    mocks.rpc.mockImplementationOnce(() => new Promise((resolve) => (resolverPrimera = resolve)))
    mocks.rpc.mockImplementationOnce(() => Promise.resolve(contacto('San Javucho', '+54 9 11 1111-2222')))

    const { result, rerender } = renderHook(({ host }) => useContactoWhatsapp(host), {
      initialProps: { host: HOST },
    })
    expect(result.current.fase).toBe('cargando')

    rerender({ host: 'sanjavucho.localhost' })
    await waitFor(() => expect(result.current).toMatchObject({
      fase: 'listo',
      contacto: { nombre: 'San Javucho' },
    }))

    // La tienda anterior responde después: su contacto no puede pisar al de la tienda vigente.
    await act(async () => {
      resolverPrimera(contacto('Mundo JC', NUMERO))
    })
    expect(result.current).toMatchObject({
      fase: 'listo',
      contacto: { nombre: 'San Javucho', digitos: '5491111112222' },
    })
  })
})
