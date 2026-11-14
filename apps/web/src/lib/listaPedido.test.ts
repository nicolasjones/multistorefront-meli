import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agregarALista,
  almacenamientoBloqueado,
  fijarCantidad,
  leerLista,
  MAX_LINEAS_LISTA,
  MAX_UNIDADES_LINEA,
  nombreAccesibleLista,
  normalizarLineas,
  quitarDeLista,
  quitarVariosDeLista,
  reiniciarListaPedido,
  suscribirLista,
  vaciarLista,
} from './listaPedido'

const HOST = 'mundojc.localhost'
const OTRO_HOST = 'sanjavucho.localhost'
const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`

beforeEach(() => {
  window.localStorage.clear()
  reiniciarListaPedido()
  vi.restoreAllMocks()
})

describe('lista de pedido del navegador (B1, FR-020, FR-022)', () => {
  it('agrega un producto con 1 unidad y suma al repetirlo', () => {
    expect(agregarALista(HOST, id(1))).toEqual({ estado: 'ok', cantidad: 1 })
    expect(agregarALista(HOST, id(1))).toEqual({ estado: 'ok', cantidad: 2 })
    expect(leerLista(HOST)).toEqual([{ productoId: id(1), cantidad: 2 }])
  })

  it('es por tienda: lo de un host no aparece en otro', () => {
    agregarALista(HOST, id(1))
    expect(leerLista(OTRO_HOST)).toEqual([])
  })

  it('NUNCA guarda precios: solo producto_id y cantidad', () => {
    agregarALista(HOST, id(1), 3)
    const guardado = JSON.parse(window.localStorage.getItem(`msf.lista-pedido.v1:${HOST}`) ?? 'null') as Array<Record<string, unknown>>
    expect(guardado).toEqual([{ p: id(1), c: 3 }])
    expect(Object.keys(guardado[0]).sort()).toEqual(['c', 'p'])
  })

  it('descarta claves ajenas (un precio escrito a mano) y líneas inválidas al leer', () => {
    window.localStorage.setItem(`msf.lista-pedido.v1:${HOST}`, JSON.stringify([
      { p: id(1), c: 2, precio: 1, descuento: 90 },
      { p: 'no-es-uuid', c: 1 },
      { p: id(2), c: -1 },
      { p: id(3), c: 1.5 },
      { p: id(4), c: '3' },
      { p: id(5), c: 99999 },
      null,
      5,
    ]))
    expect(leerLista(HOST)).toEqual([{ productoId: id(1), cantidad: 2 }, { productoId: id(5), cantidad: MAX_UNIDADES_LINEA }])
  })

  it('un almacenamiento corrupto o con otro tipo de dato da una lista vacía', () => {
    window.localStorage.setItem(`msf.lista-pedido.v1:${HOST}`, '{no es json')
    expect(leerLista(HOST)).toEqual([])
    window.localStorage.setItem(`msf.lista-pedido.v1:${HOST}`, '{"p":1}')
    expect(leerLista(HOST)).toEqual([])
  })

  it('tope de 9.999 unidades por producto: queda en el máximo y avisa', () => {
    agregarALista(HOST, id(1), 9990)
    expect(agregarALista(HOST, id(1), 9)).toEqual({ estado: 'ok', cantidad: 9999 })
    expect(agregarALista(HOST, id(1))).toEqual({ estado: 'tope_unidades', cantidad: 9999 })
    expect(leerLista(HOST)[0].cantidad).toBe(9999)
  })

  it('tope de 50 productos distintos: el 51 no se agrega, pero se puede sumar a uno que ya está', () => {
    for (let n = 1; n <= MAX_LINEAS_LISTA; n += 1) expect(agregarALista(HOST, id(n)).estado).toBe('ok')
    expect(agregarALista(HOST, id(51))).toEqual({ estado: 'tope_lineas' })
    expect(leerLista(HOST)).toHaveLength(MAX_LINEAS_LISTA)
    expect(agregarALista(HOST, id(1))).toEqual({ estado: 'ok', cantidad: 2 })
  })

  it('un id que no es de producto no se guarda', () => {
    expect(agregarALista(HOST, 'esto no es un uuid')).toEqual({ estado: 'invalido' })
    expect(agregarALista('', id(1))).toEqual({ estado: 'invalido' })
    expect(leerLista(HOST)).toEqual([])
  })

  it('fija la cantidad exacta dentro de 1 a 9.999, quita, quita varios y vacía', () => {
    agregarALista(HOST, id(1))
    agregarALista(HOST, id(2))
    agregarALista(HOST, id(3))
    fijarCantidad(HOST, id(1), 12)
    fijarCantidad(HOST, id(2), 0)
    fijarCantidad(HOST, id(3), 100000)
    expect(leerLista(HOST).map((linea) => linea.cantidad)).toEqual([12, 1, MAX_UNIDADES_LINEA])
    quitarDeLista(HOST, id(2))
    expect(leerLista(HOST).map((linea) => linea.productoId)).toEqual([id(1), id(3)])
    quitarVariosDeLista(HOST, [id(1), id(9)])
    expect(leerLista(HOST).map((linea) => linea.productoId)).toEqual([id(3)])
    vaciarLista(HOST)
    expect(leerLista(HOST)).toEqual([])
    expect(window.localStorage.getItem(`msf.lista-pedido.v1:${HOST}`)).toBeNull()
  })

  it('la referencia devuelta es la misma mientras la lista no cambie (para useSyncExternalStore)', () => {
    agregarALista(HOST, id(1))
    expect(leerLista(HOST)).toBe(leerLista(HOST))
    const antes = leerLista(HOST)
    agregarALista(HOST, id(2))
    expect(leerLista(HOST)).not.toBe(antes)
  })

  it('avisa a los suscriptores al cambiar y deja de avisar al darse de baja', () => {
    const oyente = vi.fn()
    const baja = suscribirLista(HOST, oyente)
    agregarALista(HOST, id(1))
    expect(oyente).toHaveBeenCalledTimes(1)
    baja()
    agregarALista(HOST, id(2))
    expect(oyente).toHaveBeenCalledTimes(1)
  })

  it('otra pestaña: el evento storage hace releer la lista', () => {
    const oyente = vi.fn()
    suscribirLista(HOST, oyente)
    window.localStorage.setItem(`msf.lista-pedido.v1:${HOST}`, JSON.stringify([{ p: id(7), c: 4 }]))
    window.dispatchEvent(new StorageEvent('storage', { key: `msf.lista-pedido.v1:${HOST}` }))
    expect(oyente).toHaveBeenCalled()
    expect(leerLista(HOST)).toEqual([{ productoId: id(7), cantidad: 4 }])
  })

  it('con el almacenamiento bloqueado la lista funciona en memoria y se avisa', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('bloqueado', 'SecurityError') })
    expect(agregarALista(HOST, id(1), 2)).toEqual({ estado: 'ok', cantidad: 2 })
    expect(agregarALista(HOST, id(2))).toEqual({ estado: 'ok', cantidad: 1 })
    expect(leerLista(HOST)).toEqual([{ productoId: id(1), cantidad: 2 }, { productoId: id(2), cantidad: 1 }])
    expect(almacenamientoBloqueado()).toBe(true)
    quitarDeLista(HOST, id(1))
    expect(leerLista(HOST)).toEqual([{ productoId: id(2), cantidad: 1 }])
    vaciarLista(HOST)
    expect(leerLista(HOST)).toEqual([])
  })

  it('normalizarLineas suma repetidos con tope y respeta las 50 líneas', () => {
    expect(normalizarLineas([{ p: id(1), c: 9000 }, { p: id(1), c: 9000 }, { p: id(1).toUpperCase(), c: 1 }])).toEqual([{ productoId: id(1), cantidad: 9999 }])
    expect(normalizarLineas(Array.from({ length: 60 }, (_, n) => ({ p: id(n + 1), c: 1 })))).toHaveLength(MAX_LINEAS_LISTA)
  })

  it('nombre accesible del indicador: vacía, 1 producto, varios', () => {
    expect(nombreAccesibleLista(0)).toBe('Mi lista, vacía')
    expect(nombreAccesibleLista(1)).toBe('Mi lista, 1 producto')
    expect(nombreAccesibleLista(3)).toBe('Mi lista, 3 productos')
  })
})
