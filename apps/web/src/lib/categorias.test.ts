import { describe, expect, it, vi } from 'vitest'
import {
  type Categoria,
  armarArbol,
  asignarCategoriaProducto,
  eliminarCategoria,
  filtrarArbolPorTienda,
  guardarCategoria,
  leerCategorias,
  mensajeErrorCategoria,
  esAntepasada,
  moverEnNivel,
  nivelCategoria,
  nombreRepetidoEnNivel,
  opcionesCategoriaProducto,
  opcionesPadre,
  reordenarCategorias,
  rutaCategoria,
  soltarSobre,
  validarNombreCategoria,
} from './categorias'

const cat = (id: string, nombre: string, padre_id: string | null, posicion: number, empresa_ids: string[] = []): Categoria => ({
  id, nombre, padre_id, posicion, empresa_ids,
})

// Joysticks (Cableados, Inalámbricos) · Fundas (sin hijas) · Cables
const CATEGORIAS: Categoria[] = [
  cat('joy', 'Joysticks', null, 0, ['e1', 'e2']),
  cat('cab', 'Cableados', 'joy', 0, ['e2']),
  cat('ina', 'Inalámbricos', 'joy', 1),
  cat('fun', 'Fundas', null, 1),
  cat('cbl', 'Cables', null, 2),
]

// Con tercer nivel: Joysticks > Cableados > PS3.
const CATEGORIAS_3_NIVELES: Categoria[] = [
  cat('joy', 'Joysticks', null, 0, ['e1', 'e2']),
  cat('cab', 'Cableados', 'joy', 0, ['e2']),
  cat('ps3', 'PS3', 'cab', 0),
  cat('fun', 'Fundas', null, 1),
]

const ordenDe = (resultado: ReturnType<typeof moverEnNivel>) => {
  if (!resultado.ok) throw new Error('se esperaba un movimiento válido')
  return resultado.orden
}

describe('validarNombreCategoria', () => {
  it('rechaza el nombre vacío o solo espacios y el que pasa de 100 caracteres', () => {
    expect(validarNombreCategoria('   ')).toBe('El nombre es obligatorio.')
    expect(validarNombreCategoria('a'.repeat(101))).toBe('El nombre admite hasta 100 caracteres.')
    expect(validarNombreCategoria('  Fundas rígidas ')).toBeNull()
  })
})

describe('armarArbol', () => {
  it('arma 2 niveles ordenados por posición y suma los productos de las subcategorías', () => {
    const arbol = armarArbol(CATEGORIAS, new Map([['joy', 1], ['cab', 3], ['ina', 2], ['fun', 4]]))
    expect(arbol.map((n) => n.nombre)).toEqual(['Joysticks', 'Fundas', 'Cables'])
    expect(arbol[0].hijos.map((n) => n.nombre)).toEqual(['Cableados', 'Inalámbricos'])
    expect(arbol[0].productos_directos).toBe(1)
    expect(arbol[0].productos).toBe(6)
    expect(arbol[1].productos).toBe(4)
    expect(arbol[2].productos).toBe(0)
  })
  it('arma el tercer nivel y suma los productos de toda la rama', () => {
    const arbol = armarArbol(CATEGORIAS_3_NIVELES, new Map([['joy', 1], ['cab', 3], ['ps3', 2]]))
    expect(arbol[0].hijos[0].hijos.map((n) => n.nombre)).toEqual(['PS3'])
    expect(arbol[0].hijos[0].productos).toBe(5)
    expect(arbol[0].productos).toBe(6)
  })
  it('una subcategoría cuyo padre no llegó se muestra como raíz', () => {
    const arbol = armarArbol([cat('x', 'Huérfana', 'no-existe', 0)])
    expect(arbol.map((n) => n.id)).toEqual(['x'])
  })
})

describe('filtrarArbolPorTienda', () => {
  const arbol = armarArbol(CATEGORIAS)
  it('sin tienda elegida muestra todo', () => {
    expect(filtrarArbolPorTienda(arbol, null)).toHaveLength(3)
  })
  it('deja las visibles en esa tienda y conserva la raíz de una subcategoría visible', () => {
    const e2 = filtrarArbolPorTienda(arbol, 'e2')
    expect(e2.map((n) => n.id)).toEqual(['joy'])
    expect(e2[0].hijos.map((n) => n.id)).toEqual(['cab'])
    const e1 = filtrarArbolPorTienda(arbol, 'e1')
    expect(e1[0].hijos).toEqual([])
  })
  it('recalcula el conteo de la raíz con las subcategorías que quedan a la vista', () => {
    const con = armarArbol(
      [cat('p', 'Padre', null, 0, ['e1']), cat('a', 'A', 'p', 0, ['e1']), cat('b', 'B', 'p', 1, ['e2'])],
      new Map([['p', 1], ['a', 2], ['b', 5]]),
    )
    expect(filtrarArbolPorTienda(con, null)[0].productos).toBe(8)
    expect(filtrarArbolPorTienda(con, 'e1')[0].productos).toBe(3)
  })
  it('filtra también el tercer nivel', () => {
    const arbol = armarArbol(CATEGORIAS_3_NIVELES)
    expect(filtrarArbolPorTienda(arbol, 'e2')[0].hijos[0].hijos).toEqual([])
  })
  it('una raíz oculta con una hija visible no esconde a la hija', () => {
    const con = armarArbol([cat('p', 'Padre', null, 0), cat('h', 'Hija', 'p', 0, ['e1'])])
    expect(filtrarArbolPorTienda(con, 'e1').map((n) => [n.id, n.hijos.map((h) => h.id)])).toEqual([['p', ['h']]])
  })
})

describe('rutaCategoria y opcionesPadre', () => {
  it('arma «Padre > Hija» y deja las raíces tal cual', () => {
    expect(rutaCategoria(CATEGORIAS[1], CATEGORIAS)).toBe('Joysticks > Cableados')
    expect(rutaCategoria(CATEGORIAS[0], CATEGORIAS)).toBe('Joysticks')
  })
  it('ofrece raíces y subcategorías como padre (3 niveles) y nunca la propia', () => {
    expect(opcionesPadre(CATEGORIAS, null).map((c) => c.id)).toEqual(['cab', 'joy', 'fun', 'ina', 'cbl'])
    expect(opcionesPadre(CATEGORIAS, 'fun').map((c) => c.id)).toEqual(['cab', 'joy', 'ina', 'cbl'])
  })
  it('una categoría con subcategorías solo puede colgar de una raíz', () => {
    expect(opcionesPadre(CATEGORIAS, 'joy').map((c) => c.id)).toEqual(['fun', 'cbl'])
  })
  it('no ofrece el tercer nivel como padre ni los descendientes de la que se edita', () => {
    expect(opcionesPadre(CATEGORIAS_3_NIVELES, null).map((c) => c.id)).toEqual(['cab', 'joy', 'fun'])
    expect(opcionesPadre(CATEGORIAS_3_NIVELES, 'cab').map((c) => c.id)).toEqual(['joy', 'fun'])
    expect(opcionesPadre(CATEGORIAS_3_NIVELES, 'ps3').map((c) => c.id)).toEqual(['cab', 'joy', 'fun'])
  })
})

describe('nombreRepetidoEnNivel', () => {
  it('no distingue mayúsculas ni espacios extremos y respeta el nivel', () => {
    expect(nombreRepetidoEnNivel(CATEGORIAS, '  fundas ', null)).toBe(true)
    expect(nombreRepetidoEnNivel(CATEGORIAS, 'Fundas', 'joy')).toBe(false)
    expect(nombreRepetidoEnNivel(CATEGORIAS, 'Fundas', null, 'fun')).toBe(false)
  })
})

describe('moverEnNivel (Subir / Bajar por teclado)', () => {
  it('intercambia con el hermano y devuelve el árbol completo con posiciones 0..n', () => {
    const orden = ordenDe(moverEnNivel(CATEGORIAS, 'fun', -1))
    expect(orden.filter((o) => o.padre_id === null).sort((a, b) => a.posicion - b.posicion).map((o) => o.id)).toEqual(['fun', 'joy', 'cbl'])
    expect(orden.find((o) => o.id === 'cab')).toEqual({ id: 'cab', padre_id: 'joy', posicion: 0 })
  })
  it('con vista filtrada salta las hermanas ocultas: intercambia con la visible más cercana', () => {
    // joy · fun · cbl (raíces); «fun» oculta → cbl sube sobre joy, saltando a fun.
    const orden = ordenDe(moverEnNivel(CATEGORIAS, 'cbl', -1, new Set(['joy', 'cbl'])))
    expect(orden.filter((o) => o.padre_id === null).sort((a, b) => a.posicion - b.posicion).map((o) => o.id)).toEqual(['cbl', 'joy', 'fun'])
  })
  it('con vista filtrada, si no hay hermana visible de ese lado no hace nada', () => {
    expect(moverEnNivel(CATEGORIAS, 'cbl', 1, new Set(['joy', 'cbl']))).toEqual({ ok: false, motivo: null })
  })
  it('en el borde no hay nada que mover (sin motivo de error)', () => {
    expect(moverEnNivel(CATEGORIAS, 'joy', -1)).toEqual({ ok: false, motivo: null })
    expect(moverEnNivel(CATEGORIAS, 'cbl', 1)).toEqual({ ok: false, motivo: null })
  })
})

describe('soltarSobre (arrastrar y soltar)', () => {
  it('reordena dentro de su nivel tomando el lugar de la fila de destino', () => {
    const orden = ordenDe(soltarSobre(CATEGORIAS, 'joy', 'cbl'))
    expect(orden.filter((o) => o.padre_id === null).sort((a, b) => a.posicion - b.posicion).map((o) => o.id)).toEqual(['fun', 'cbl', 'joy'])
  })
  it('soltar una subcategoría sobre otra raíz la mueve al final de esa raíz', () => {
    const orden = ordenDe(soltarSobre(CATEGORIAS, 'cab', 'fun'))
    expect(orden.find((o) => o.id === 'cab')).toEqual({ id: 'cab', padre_id: 'fun', posicion: 0 })
    expect(orden.find((o) => o.id === 'ina')).toEqual({ id: 'ina', padre_id: 'joy', posicion: 0 })
  })
  it('una raíz sin hijas puede pasar a ser subcategoría soltándola sobre una hija de otra raíz', () => {
    const orden = ordenDe(soltarSobre(CATEGORIAS, 'fun', 'ina'))
    expect(orden.find((o) => o.id === 'fun')?.padre_id).toBe('joy')
  })
  it('rechaza mover bajo otra una raíz que ya tiene subcategorías (3 niveles)', () => {
    const resultado = soltarSobre(CATEGORIAS, 'joy', 'ina')
    expect(resultado.ok).toBe(false)
    expect(resultado).toMatchObject({ motivo: expect.stringContaining('3 niveles') })
  })
  it('soltar sobre una subcategoría deja la hoja al lado de ella (mismo nivel)', () => {
    const orden = ordenDe(soltarSobre(CATEGORIAS_3_NIVELES, 'fun', 'cab'))
    expect(orden.find((o) => o.id === 'fun')).toEqual({ id: 'fun', padre_id: 'joy', posicion: 0 })
  })
  it('rechaza un ciclo (colgar una categoría de su propia descendiente)', () => {
    const resultado = soltarSobre(CATEGORIAS_3_NIVELES, 'joy', 'ps3')
    expect(resultado.ok).toBe(false)
    expect(resultado).toMatchObject({ motivo: expect.stringContaining('3 niveles') })
  })
  it('rechaza el movimiento que repetiría un nombre en el nivel de destino', () => {
    const con = [...CATEGORIAS, cat('c2', 'cableados', 'fun', 0)]
    expect(soltarSobre(con, 'cab', 'fun')).toEqual({ ok: false, motivo: 'Ya existe una categoría con ese nombre en ese nivel' })
  })
  it('soltar sobre sí misma no hace nada', () => {
    expect(soltarSobre(CATEGORIAS, 'joy', 'joy')).toEqual({ ok: false, motivo: null })
  })
})

describe('nivelCategoria y esAntepasada (3 niveles)', () => {
  it('calcula la profundidad de cada categoría', () => {
    expect(nivelCategoria(CATEGORIAS_3_NIVELES, 'joy')).toBe(1)
    expect(nivelCategoria(CATEGORIAS_3_NIVELES, 'cab')).toBe(2)
    expect(nivelCategoria(CATEGORIAS_3_NIVELES, 'ps3')).toBe(3)
  })
  it('reconoce antepasadas (para no dejar ciclos)', () => {
    expect(esAntepasada(CATEGORIAS_3_NIVELES, 'joy', 'ps3')).toBe(true)
    expect(esAntepasada(CATEGORIAS_3_NIVELES, 'cab', 'ps3')).toBe(true)
    expect(esAntepasada(CATEGORIAS_3_NIVELES, 'ps3', 'joy')).toBe(false)
  })
})

describe('opcionesCategoriaProducto', () => {
  it('ofrece los tres niveles con su ruta completa', () => {
    const opciones = opcionesCategoriaProducto(CATEGORIAS_3_NIVELES)
    expect(opciones.find((o) => o.id === 'ps3')).toEqual({ id: 'ps3', ruta: 'Joysticks > Cableados > PS3', nivel: 2 })
    expect(opciones.find((o) => o.id === 'cab')?.ruta).toBe('Joysticks > Cableados')
  })
})

describe('acceso a datos', () => {
  it('guardarCategoria llama a la RPC con el contrato de la base', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'nueva', error: null })
    expect(await guardarCategoria({ rpc } as never, { id: null, nombre: 'Fundas', padreId: 'joy', empresaIds: ['e1'] })).toBe('nueva')
    expect(rpc).toHaveBeenCalledWith('guardar_categoria', { p_id: null, p_nombre: 'Fundas', p_padre_id: 'joy', p_empresa_ids: ['e1'] })
  })
  it('reordenar, eliminar y asignar usan sus RPC y propagan el error del servidor', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: { productos: 3, subcategorias: 1 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '23514', message: 'Las categorías admiten hasta 3 niveles' } })
    await reordenarCategorias({ rpc } as never, [{ id: 'a', padre_id: null, posicion: 0 }])
    expect(rpc).toHaveBeenLastCalledWith('reordenar_categorias', { p_orden: [{ id: 'a', padre_id: null, posicion: 0 }] })
    expect(await eliminarCategoria({ rpc } as never, 'joy')).toEqual({ productos: 3, subcategorias: 1 })
    expect(rpc).toHaveBeenLastCalledWith('eliminar_categoria', { p_id: 'joy' })
    await asignarCategoriaProducto({ rpc } as never, 'p-1', 'joy')
    expect(rpc).toHaveBeenLastCalledWith('asignar_categoria_producto', { p_producto_id: 'p-1', p_categoria_id: 'joy' })
    await expect(reordenarCategorias({ rpc } as never, [])).rejects.toMatchObject({ code: '23514' })
  })
  it('leerCategorias junta categorías, visibilidad por tienda y conteos', async () => {
    const tablas: Record<string, unknown> = {
      categorias: { data: [{ id: 'joy', nombre: 'Joysticks', padre_id: null, posicion: 0 }], error: null },
      categorias_empresa: { data: [{ categoria_id: 'joy', empresa_id: 'e1' }, { categoria_id: 'joy', empresa_id: 'e2' }], error: null },
    }
    const cliente = {
      schema: () => ({ from: (tabla: string) => ({ select: () => ({ returns: () => Promise.resolve(tablas[tabla]) }) }) }),
      from: () => ({ select: () => ({ returns: () => Promise.resolve({ data: [{ categoria_id: 'joy', productos: 4 }], error: null }) }) }),
    }
    const { categorias, conteos } = await leerCategorias(cliente as never)
    expect(categorias).toEqual([{ id: 'joy', nombre: 'Joysticks', padre_id: null, posicion: 0, empresa_ids: ['e1', 'e2'] }])
    expect(conteos.get('joy')).toBe(4)
  })
  it('mensajeErrorCategoria muestra el texto de la base solo para errores esperados', () => {
    expect(mensajeErrorCategoria({ code: '23505', message: 'Ya existe una categoría con ese nombre en ese nivel' }, 'x')).toBe('Ya existe una categoría con ese nombre en ese nivel')
    expect(mensajeErrorCategoria({ code: '57014', message: 'canceling statement' }, 'No pudimos guardar')).toBe('No pudimos guardar')
    expect(mensajeErrorCategoria(new Error('red'), 'No pudimos guardar')).toBe('No pudimos guardar')
  })
})
