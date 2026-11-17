import { describe, expect, it } from 'vitest'
import { consultarImagenesPrincipales } from '../lib/imagenesPrincipales'
import { clienteSupabaseSimulado } from './supabaseSimulado'

describe('clienteSupabaseSimulado', () => {
  it('implementa schema(): el cliente de las pantallas ya no cae en «schema is not a function»', async () => {
    const cliente = clienteSupabaseSimulado({ tablas: { 'dominio.empresas': [{ id: 'e1' }], productos: [{ id: 'p1' }] }, rpc: { saludo: 'hola' } })
    expect(await cliente.schema('dominio').from('empresas').select('*').eq('id', 'e1').order('id')).toEqual({ data: [{ id: 'e1' }], error: null, count: 1 })
    expect(cliente.schema).toHaveBeenCalledWith('dominio')
    expect((await cliente.schema('publico').rpc('saludo')).data).toBe('hola')
    expect((await cliente.from('productos').select('id')).data).toEqual([{ id: 'p1' }])
    expect((await cliente.from('vacia')).data).toEqual([])
  })

  it('filtra de forma mínima (eq, in, order, limit) y firma con la forma real', async () => {
    const filas = [{ id: 'b', n: 2 }, { id: 'a', n: 1 }, { id: 'c', n: 3 }]
    const cliente = clienteSupabaseSimulado({ tablas: { t: filas }, firmadas: { 'ok.png': 'https://f/ok' } })
    expect((await cliente.from('t').eq('id', 'a')).data).toEqual([{ id: 'a', n: 1 }])
    expect((await cliente.from('t').in('id', ['a', 'c']).order('n', { ascending: false })).data).toEqual([{ id: 'c', n: 3 }, { id: 'a', n: 1 }])
    expect((await cliente.from('t').order('n').limit(2)).data).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 2 }])
    const { data } = await cliente.storage.from('b').createSignedUrls(['ok.png', 'falta.png'])
    expect(data).toEqual([{ path: 'ok.png', signedUrl: 'https://f/ok', error: null }, { path: 'falta.png', signedUrl: '', error: 'Object not found' }])
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
