// MSF-825 (MSF-828): textos de la tienda pública sin restos de importación. La base ya los limpia al escribir
// (private.quitar_prefijo_importacion); esto es la red de seguridad al mostrar, para no depender de la carga.

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü',
}

// «&amp;», «&#39;», «&#x27;»… Solo entidades conocidas; el resto queda literal. El resultado va siempre como
// nodo de React (se escapa solo), así que decodificar no abre ninguna puerta a HTML.
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (entera, cuerpo: string) => {
    if (cuerpo.startsWith('#')) {
      const codigo = cuerpo[1] === 'x' || cuerpo[1] === 'X' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10)
      return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entera
    }
    return ENTIDADES[cuerpo] ?? entera
  })
}

// «&ua ADAPTADOR…» → «ADAPTADOR…»: «&» + una o más de u, U, a, k o «+» (&ua, &uu, &u+, &+, &uk…) y luego un
// espacio o una mayúscula/dígito/«(» pegados («&uaCONSOLA»); o «&» + espacio. «&ultra Cable» y «&Kids» no se tocan. Una entidad HTML («&amp;») no es un prefijo. Si el texto fuera solo el prefijo, se deja como está.
export function quitarPrefijoImportacion(texto: string): string {
  if (/^&[A-Za-z0-9#]+;/.test(texto)) return texto
  const limpio = texto.replace(/^&(?:[uUa+k]+(?:\s+|(?=[A-Z0-9(]))|\s+)/, '').trim()
  return limpio === '' ? texto : limpio
}

export function limpiarTextoPublico(texto: string): string {
  return decodificarEntidades(quitarPrefijoImportacion(texto)).replace(/\s+/g, ' ').trim()
}


// La descripción conserva los saltos de línea (la ficha los respeta): solo se quita el prefijo y se decodifica.
export function limpiarDescripcionPublica(texto: string | null | undefined): string | null {
  if (texto == null) return null
  const limpia = decodificarEntidades(quitarPrefijoImportacion(texto)).trim()
  return limpia === '' ? null : limpia
}
