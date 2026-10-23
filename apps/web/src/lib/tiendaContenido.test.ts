import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), rpcPublico: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn() }))

vi.mock('./supabase', () => ({
  supabaseClient: {
    rpc: mocks.rpc,
    schema: (nombre: string) => ({
      rpc: nombre === 'publico' ? mocks.rpcPublico : vi.fn(),
      from: () => ({ select: () => ({ eq: (...args: unknown[]) => { mocks.eq(nombre, ...args); return { maybeSingle: mocks.maybeSingle } } }) }),
    }),
  },
}))

import {
  CONTENIDO_VACIO,
  ErrorGuardadoContenido,
  contenidoIgual,
  guardarContenido,
  leerContenido,
  leerContenidoPublico,
  reiniciarContenidoPublico,
  largoContenido,
  validarContenido,
} from './tiendaContenido'

describe('validarContenido (FR-032, FR-033)', () => {
  it('acepta el contenido vacío y el que está justo en el límite', () => {
    expect(validarContenido(CONTENIDO_VACIO)).toEqual({})
    expect(validarContenido({ ...CONTENIDO_VACIO, titulo: 'a'.repeat(120), pie: 'b'.repeat(300) })).toEqual({})
  })

  it.each([
    ['titulo', 121, 'Título no puede superar los 120 caracteres.'],
    ['subtitulo', 301, 'Subtítulo no puede superar los 300 caracteres.'],
    ['texto_boton', 121, 'Texto del botón no puede superar los 120 caracteres.'],
    ['bienvenida', 301, 'Mensaje de bienvenida (barra superior) no puede superar los 300 caracteres.'],
    ['pie', 301, 'Texto del pie de página no puede superar los 300 caracteres.'],
    ['aviso_ficha', 301, 'Aviso en la ficha de producto no puede superar los 300 caracteres.'],
    ['texto_boton_contacto', 121, 'Texto del botón de contacto no puede superar los 120 caracteres.'],
  ])('marca %s cuando pasa el límite (%i caracteres)', (clave, largo, mensaje) => {
    expect(validarContenido({ ...CONTENIDO_VACIO, [clave]: 'a'.repeat(largo) })).toEqual({ [clave]: mensaje })
  })

  it('no cuenta los espacios de los extremos (la base los recorta)', () => {
    expect(validarContenido({ ...CONTENIDO_VACIO, titulo: `  ${'a'.repeat(120)}  ` })).toEqual({})
  })

  it('cuenta puntos de código como la base: un emoji vale un carácter', () => {
    expect(validarContenido({ ...CONTENIDO_VACIO, titulo: '😀'.repeat(120) })).toEqual({})
  })

  it('rechaza un destino fuera de la lista cerrada', () => {
    const valores = { ...CONTENIDO_VACIO, boton_destino: 'https://malo.example' } as unknown as typeof CONTENIDO_VACIO
    expect(validarContenido(valores)).toEqual({ boton_destino: 'Elegí un destino de la lista.' })
  })
})

describe('largoContenido', () => {
  it('cuenta puntos de código y recorta los extremos', () => {
    expect(largoContenido('  😀😀 ')).toBe(2)
    expect(largoContenido('😀'.repeat(100))).toBe(100)
  })
})

describe('contenidoIgual', () => {
  it('ignora los espacios de los extremos', () => {
    expect(contenidoIgual({ ...CONTENIDO_VACIO, titulo: ' Hola ' }, { ...CONTENIDO_VACIO, titulo: 'Hola' })).toBe(true)
    expect(contenidoIgual({ ...CONTENIDO_VACIO, titulo: 'Hola' }, { ...CONTENIDO_VACIO, titulo: 'Chau' })).toBe(false)
  })
})

describe('leerContenido', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sin fila devuelve todo vacío', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(leerContenido('e-1')).resolves.toEqual(CONTENIDO_VACIO)
    expect(mocks.eq).toHaveBeenCalledWith('dominio', 'empresa_id', 'e-1')
  })

  it('propaga el error de lectura', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(leerContenido('e-1')).rejects.toThrow('boom')
  })
})

describe('guardarContenido (FR-035)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('llama a la RPC con todos los campos y devuelve lo guardado', async () => {
    const fila = { ...CONTENIDO_VACIO, titulo: 'Todo para tu consola' }
    mocks.rpc.mockResolvedValue({ data: fila, error: null })

    await expect(guardarContenido('e-1', fila)).resolves.toEqual(fila)
    expect(mocks.rpc).toHaveBeenCalledWith('guardar_tienda_contenido', {
      p_empresa_id: 'e-1',
      p_titulo: 'Todo para tu consola',
      p_subtitulo: '',
      p_texto_boton: '',
      p_boton_destino: 'catalogo',
      p_bienvenida: '',
      p_pie: '',
      p_aviso_ficha: '',
      p_texto_boton_contacto: '',
    })
  })

  it('devuelve el campo que rechazó la base (hint)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'El título no puede superar los 120 caracteres', hint: 'titulo' } })
    const error = await guardarContenido('e-1', CONTENIDO_VACIO).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorGuardadoContenido)
    expect((error as ErrorGuardadoContenido).campo).toBe('titulo')
  })

  it('un error sin campo conocido no apunta a ningún campo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Tu rol no puede editar', hint: null } })
    const error = await guardarContenido('e-1', CONTENIDO_VACIO).catch((e: unknown) => e)
    expect((error as ErrorGuardadoContenido).campo).toBeNull()
  })
})

describe('leerContenidoPublico (FR-036)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reiniciarContenidoPublico()
  })

  it('devuelve null si el dominio no tiene filas', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: [], error: null })
    await expect(leerContenidoPublico('x.ejemplo.com')).resolves.toBeNull()
  })

  it('comparte una sola petición por host', async () => {
    mocks.rpcPublico.mockResolvedValue({ data: [{ titulo: 'Hola', boton_destino: 'catalogo' }], error: null })
    const [a, b] = await Promise.all([leerContenidoPublico('x.ejemplo.com'), leerContenidoPublico('x.ejemplo.com')])
    expect(a?.titulo).toBe('Hola')
    expect(b).toBe(a)
    expect(mocks.rpcPublico).toHaveBeenCalledTimes(1)
    expect(mocks.rpcPublico).toHaveBeenCalledWith('contenido_por_dominio', { host: 'x.ejemplo.com' })
  })

  it('un error no queda en la caché: el siguiente intento vuelve a pedir', async () => {
    mocks.rpcPublico.mockResolvedValueOnce({ data: null, error: { message: 'red' } })
    await expect(leerContenidoPublico('x.ejemplo.com')).rejects.toThrow('red')
    mocks.rpcPublico.mockResolvedValueOnce({ data: [{ titulo: 'Hola' }], error: null })
    await expect(leerContenidoPublico('x.ejemplo.com')).resolves.toMatchObject({ titulo: 'Hola' })
    expect(mocks.rpcPublico).toHaveBeenCalledTimes(2)
  })
})
