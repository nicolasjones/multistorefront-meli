// F-TDA-21 (FR-022): datos estructurados JSON-LD de la tienda. Solo campos que la tienda ya muestra en pantalla;
// nunca costos ni existencias (la disponibilidad es un booleano). Los constructores devuelven objetos; el
// texto que va a la página sale de `serializarJsonLd`, que escapa `<` para que ningún valor cierre el `<script>`.

export type OrganizacionJsonLd = {
  '@context': 'https://schema.org'
  '@type': 'Organization'
  name: string
  url: string
  logo?: string
}

export type ProductoJsonLd = {
  '@context': 'https://schema.org'
  '@type': 'Product'
  name: string
  description?: string
  sku?: string
  image?: string[]
  url?: string
  offers: {
    '@type': 'Offer'
    priceCurrency: 'ARS'
    price?: string
    availability: 'https://schema.org/InStock' | 'https://schema.org/OutOfStock'
    url?: string
  }
}

export function organizacionJsonLd(datos: { nombre: string; url: string; logo?: string | null }): OrganizacionJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: datos.nombre,
    url: datos.url,
    ...(datos.logo ? { logo: datos.logo } : {}),
  }
}

export function productoJsonLd(datos: {
  nombre: string
  descripcion?: string | null
  sku?: string | null
  imagen?: string | null
  url?: string
  // `null` = no calculable (sin precio de lista): el campo `price` no se escribe.
  precio: number | null
  disponible: boolean
}): ProductoJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: datos.nombre,
    ...(datos.descripcion?.trim() ? { description: datos.descripcion.trim() } : {}),
    ...(datos.sku ? { sku: datos.sku } : {}),
    ...(datos.imagen ? { image: [datos.imagen] } : {}),
    ...(datos.url ? { url: datos.url } : {}),
    offers: {
      '@type': 'Offer',
      priceCurrency: 'ARS',
      ...(datos.precio !== null && Number.isFinite(datos.precio) ? { price: datos.precio.toFixed(2) } : {}),
      availability: datos.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      ...(datos.url ? { url: datos.url } : {}),
    },
  }
}

// `<` (y los separadores de línea de JS) se escriben como \uXXXX: sigue siendo JSON válido y no puede aparecer
// `</script>` ni `<!--` en el texto.
export function serializarJsonLd(dato: object): string {
  return JSON.stringify(dato).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}
