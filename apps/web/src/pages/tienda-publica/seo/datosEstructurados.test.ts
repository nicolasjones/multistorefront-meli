import { describe, expect, it } from 'vitest'
import { organizacionJsonLd, productoJsonLd, serializarJsonLd } from './datosEstructurados'

// F-TDA-21 (FR-022, SC-008): JSON-LD de la tienda.
describe('organizacionJsonLd', () => {
  it('arma Organization con nombre, url y logo', () => {
    expect(organizacionJsonLd({ nombre: 'Mundo JC', url: 'https://mundojc.test/', logo: 'https://cdn.test/logo.png' })).toEqual({
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Mundo JC', url: 'https://mundojc.test/', logo: 'https://cdn.test/logo.png',
    })
  })

  it('sin logo no escribe el campo', () => {
    expect(organizacionJsonLd({ nombre: 'Mundo JC', url: 'https://mundojc.test/', logo: null })).not.toHaveProperty('logo')
  })
})

describe('productoJsonLd', () => {
  const base = { nombre: 'Joystick', descripcion: 'Con cable', sku: 'J-1', imagen: 'https://cdn.test/j.png', url: 'https://mundojc.test/producto/1' }

  it('arma Product con oferta en ARS, precio y disponibilidad', () => {
    expect(productoJsonLd({ ...base, precio: 1500, disponible: true })).toEqual({
      '@context': 'https://schema.org', '@type': 'Product', name: 'Joystick', description: 'Con cable', sku: 'J-1',
      image: ['https://cdn.test/j.png'], url: 'https://mundojc.test/producto/1',
      offers: { '@type': 'Offer', priceCurrency: 'ARS', price: '1500.00', availability: 'https://schema.org/InStock', url: 'https://mundojc.test/producto/1' },
    })
  })

  it('sin precio calculable no escribe `price`; sin stock es OutOfStock', () => {
    const json = productoJsonLd({ ...base, precio: null, disponible: false })
    expect(json.offers).not.toHaveProperty('price')
    expect(json.offers.availability).toBe('https://schema.org/OutOfStock')
    expect(json.offers.priceCurrency).toBe('ARS')
  })

  it('omite descripción, sku e imagen vacíos y no expone campos internos', () => {
    const json = productoJsonLd({ nombre: 'Cable', descripcion: '  ', sku: null, imagen: null, precio: 10, disponible: true })
    expect(Object.keys(json).sort()).toEqual(['@context', '@type', 'name', 'offers'])
  })
})

describe('serializarJsonLd', () => {
  it('escapa `<` y sigue siendo JSON válido con el mismo contenido', () => {
    const dato = productoJsonLd({ nombre: '</script><img src=x onerror=alert(1)>', precio: 1, disponible: true })
    const texto = serializarJsonLd(dato)
    expect(texto).not.toContain('<')
    expect(JSON.parse(texto).name).toBe('</script><img src=x onerror=alert(1)>')
  })
})
