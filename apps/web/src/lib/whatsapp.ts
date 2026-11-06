import { formatearPrecioArs } from './tiendaListado'

// F-TDA-14 (MSF-433): utilidades del enlace de WhatsApp desde la ficha del producto (FR-022, FR-023).
// El número, el mensaje y la URL se arman en el cliente; qué se registra en la bandeja lo decide la
// base (publico.registrar_consulta_whatsapp, FR-025). Los textos viajan como datos: nunca HTML.

const DIGITOS_MINIMOS = 8
const DIGITOS_MAXIMOS = 15
const PAIS_AR = '54'
const MOVIL_AR = '549'

// Un móvil argentino sin país son 10 dígitos (área + número). Con el `15` del discado local son 12:
// el `15` va justo después del código de área (2 a 4 dígitos).
function nacionalArgentino(digitos: string): string | null {
  const sinTroncal = digitos.startsWith('0') ? digitos.slice(1) : digitos
  if (/^[1-9]\d{9}$/.test(sinTroncal) && !sinTroncal.startsWith('15')) return sinTroncal
  if (/^[1-9]\d{11}$/.test(sinTroncal)) {
    for (const area of [2, 3, 4]) {
      if (sinTroncal.slice(area, area + 2) === '15') return sinTroncal.slice(0, area) + sinTroncal.slice(area + 2)
    }
  }
  return null
}

// Número → dígitos en formato internacional para `wa.me` (sin «+»). `wa.me` exige el código de país: un
// número local armaba el enlace con otro país (MSF-696). Reglas:
//  · «+» o «00» al inicio: ya es internacional, se respeta (8 a 15 dígitos);
//  · empieza con 54: Argentina; el móvil lleva 9 después del país (`54 11…` → `549 11…`);
//  · si no, es local argentino: se quita el 0 troncal y el 15, y se antepone 549;
//  · si no se puede determinar con certeza, null (sin enlace antes que un chat equivocado, FR-020).
export function normalizarNumero(numero: string | null | undefined): string | null {
  if (typeof numero !== 'string') return null
  const texto = numero.trim()
  const digitos = texto.replace(/\D/g, '')
  const internacional = texto.startsWith('+') || digitos.startsWith('00')
  const base = digitos.startsWith('00') && !texto.startsWith('+') ? digitos.slice(2) : digitos
  if (digitos.length < DIGITOS_MINIMOS) return null
  if (internacional) {
    if (base.length < DIGITOS_MINIMOS || base.length > DIGITOS_MAXIMOS) return null
    return base.startsWith(PAIS_AR) && !base.startsWith(MOVIL_AR) && base.length === 12 ? MOVIL_AR + base.slice(2) : base
  }
  if (base.startsWith(PAIS_AR)) {
    if (base.startsWith(MOVIL_AR) && base.length === 13) return base
    if (base.length === 12) return MOVIL_AR + base.slice(2)
    return null
  }
  const nacional = nacionalArgentino(base)
  return nacional ? MOVIL_AR + nacional : null
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
