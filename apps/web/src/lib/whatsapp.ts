import { formatearPrecioArs } from './tiendaListado'

// F-TDA-14 (MSF-433): utilidades del enlace de WhatsApp desde la ficha del producto (FR-022, FR-023).
// El número, el mensaje y la URL se arman en el cliente; qué se registra en la bandeja lo decide la
// base (publico.registrar_consulta_whatsapp, FR-025). Los textos viajan como datos: nunca HTML.

const DIGITOS_MINIMOS = 8

// Solo dígitos: '+54 9 11 5555-0001' → '5491155550001'. Con menos de 8 dígitos no hay número válido
// (FR-020: sin número válido la ficha se ve sin botón, sin hueco).
export function normalizarNumero(numero: string | null | undefined): string | null {
  if (typeof numero !== 'string') return null
  const digitos = numero.replace(/\D/g, '')
  return digitos.length >= DIGITOS_MINIMOS ? digitos : null
}

// «Hola <empresa>, quiero consultar por <producto> (<precio>). ¿Está disponible?»; si el producto no
// tiene precio, no van los paréntesis. El precio sale con el mismo formato de la ficha.
export function armarMensaje(empresa: string, producto: string, precio?: number | null): string {
  const textoPrecio = formatearPrecioArs(precio ?? null)
  const detalle = textoPrecio ? ` (${textoPrecio})` : ''
  return `Hola ${empresa}, quiero consultar por ${producto}${detalle}. ¿Está disponible?`
}

// Enlace de WhatsApp: https://wa.me/<dígitos>?text=<mensaje codificado>. Sin número válido no hay URL.
export function urlWhatsapp(numero: string | null | undefined, mensaje: string): string | null {
  const digitos = normalizarNumero(numero)
  if (!digitos) return null
  return `https://wa.me/${digitos}?text=${encodeURIComponent(mensaje)}`
}
