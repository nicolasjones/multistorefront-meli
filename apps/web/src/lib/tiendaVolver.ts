// F-CLI-20 (MSF-452, FR-002): `/ingresar?volver=<ruta>` lleva de vuelta a la pantalla que pidió el ingreso. Solo vale una
// ruta INTERNA de la tienda: si no, cualquiera podría armar un enlace de ingreso que termine en otro sitio (open redirect).

// `/…` solamente: no `//` ni `/\` (los navegadores los leen como «mismo protocolo, otro sitio»), ningún `:` (esquemas
// como `javascript:` o `https:`) ni caracteres de control o espacios. Devuelve la ruta tal cual o `null`.
export function rutaVolverSegura(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  if (valor.length === 0 || valor.length > 512) return null
  if (!valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) return null
  if (valor.includes(':') || valor.includes('\\')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f-\u009f]/.test(valor)) return null
  // La propia pantalla de ingreso no es un destino útil (volvería a pedir ingreso).
  if (/^\/ingresar(?:[/?#]|$)/.test(valor)) return null
  return valor
}

// «/ingresar?volver=%2Fmi-cuenta%3Fseccion%3Dfavoritos» para una ruta interna; sin ruta válida, `/ingresar`.
export function enlaceIngresarConVolver(ruta: string): string {
  const segura = rutaVolverSegura(ruta)
  return segura ? `/ingresar?volver=${encodeURIComponent(segura)}` : '/ingresar'
}
