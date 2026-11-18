// Nombre legible de una zona horaria IANA: «America/Argentina/Buenos_Aires» → «Buenos Aires (América/Argentina)».
// El valor que se guarda sigue siendo el identificador IANA; esto es solo lo que se lee en pantalla.
export function etiquetaZonaHoraria(zona: string): string {
  const partes = zona.split('/')
  const ciudad = (partes.pop() ?? zona).replace(/_/g, ' ')
  if (partes.length === 0) return ciudad
  const region = partes.join('/').replace(/^America(?=\/|$)/, 'América')
  return `${ciudad} (${region})`
}
