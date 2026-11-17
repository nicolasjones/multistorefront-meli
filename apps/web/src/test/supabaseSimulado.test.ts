import { describe, expect, it } from 'vitest'
import { consultarImagenesPrincipales } from '../lib/imagenesPrincipales'
import { clienteSupabaseSimulado } from './supabaseSimulado'

describe('clienteSupabaseSimulado', () => {
  it('implementa schema(): el cliente de las pantallas ya no cae en «schema is not a function»', async () => {
    const cliente = clienteSupabaseSimulado({ tablas: { 'dominio.empresas': [{ id: 'e1' }], productos: [{ id: 'p1' }] }, rpc: { saludo: 'hola' } })
    expect(await (cliente.schema('dominio').from('empresas').select('*').eq('x', 1).order('id') as PromiseLike<unknown>)).toEqual({ data: [{ id: 'e1' }], error: null, count: 1 })
    expect(cliente.schema).toHaveBeenCalledWith('dominio')
    expect((await cliente.schema('publico').rpc('saludo')).data).toBe('hola')
    expect((await (cliente.from('productos').select('id') as PromiseLike<{ data: unknown }>)).data).toEqual([{ id: 'p1' }])
    expect((await (cliente.from('vacia') as PromiseLike<{ data: unknown }>)).data).toEqual([])
  })

  it('camino feliz de las imágenes principales: la foto real se firma y llega, no el placeholder', async () => {
    const cliente = clienteSupabaseSimulado({
      tablas: { 'dominio.producto_imagenes': [{ producto_id: 'p1', ruta: 'o/p1/frente.png', posicion: 1 }] },
      firmadas: { 'o/p1/frente.png': 'https://firmada/p1' },
    })
    const { urls, fallidos } = await consultarImagenesPrincipales(cliente as never, ['p1', 'p2'])
    expect(urls.get('p1')).toBe('https://firmada/p1')
    expect(urls.has('p2')).toBe(false)
    expect(fallidos.size).toBe(0)
    expect(cliente.schema).toHaveBeenCalledWith('dominio')
  })
})
