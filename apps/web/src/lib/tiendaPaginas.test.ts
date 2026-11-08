import { describe, expect, it } from 'vitest'
import { LIMITE_CONTENIDO_PAGINA, LIMITE_TITULO_PAGINA, largoPagina, validarPagina } from './tiendaPaginas'

// Espejo del CHECK de la base (char_length: puntos de código, no unidades UTF-16).
describe('límites de las páginas de la tienda (FR-002)', () => {
  it('un contenido de exactamente 10000 caracteres es válido y 10001 no', () => {
    expect(validarPagina({ titulo: 'Envíos', contenido: 'a'.repeat(LIMITE_CONTENIDO_PAGINA) })).toEqual({})
    expect(validarPagina({ titulo: 'Envíos', contenido: 'a'.repeat(LIMITE_CONTENIDO_PAGINA + 1) }).contenido).toMatch(/10000/)
  })
  it('un emoji vale 1 (punto de código), aunque ocupe 2 unidades UTF-16', () => {
    const emoji = '😀'
    expect(emoji.length).toBe(2)
    expect(largoPagina(emoji)).toBe(1)
    expect(validarPagina({ titulo: 'x', contenido: emoji.repeat(LIMITE_CONTENIDO_PAGINA) })).toEqual({})
    expect(validarPagina({ titulo: 'x', contenido: emoji.repeat(LIMITE_CONTENIDO_PAGINA + 1) }).contenido).toBeDefined()
  })
  it('los espacios de los bordes no cuentan (la base recorta)', () => {
    expect(validarPagina({ titulo: 'x', contenido: `  ${'a'.repeat(LIMITE_CONTENIDO_PAGINA)}  ` })).toEqual({})
  })
  it('el título exige entre 1 y 80 caracteres', () => {
    expect(validarPagina({ titulo: '   ', contenido: '' }).titulo).toBeDefined()
    expect(validarPagina({ titulo: 'a'.repeat(LIMITE_TITULO_PAGINA), contenido: '' })).toEqual({})
    expect(validarPagina({ titulo: 'a'.repeat(LIMITE_TITULO_PAGINA + 1), contenido: '' }).titulo).toBeDefined()
  })
})
