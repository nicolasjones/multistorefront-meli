// Dibujo del QR como un único `<path>` de SVG (F-SVC-32, FR-040): se arma con coordenadas enteras y corridas horizontales
// fusionadas, sin concatenar HTML. El `viewBox` incluye la zona quieta (4 módulos por lado, ISO/IEC 18004).

export const ZONA_QUIETA = 4

export type QrSvg = {
  // `M<x> <y>h<largo>v1h-<largo>z` por cada corrida de módulos oscuros, en coordenadas de módulos con la zona quieta.
  path: string
  // Lado del `viewBox` cuadrado: tamaño del símbolo + 2 × zona quieta.
  lado: number
  viewBox: string
}

export function qrASvgPath(modulos: readonly (readonly boolean[])[], opciones: { zonaQuieta?: number } = {}): string {
  return qrASvg(modulos, opciones).path
}

export function qrASvg(modulos: readonly (readonly boolean[])[], opciones: { zonaQuieta?: number } = {}): QrSvg {
  const zona = opciones.zonaQuieta ?? ZONA_QUIETA
  if (!Number.isInteger(zona) || zona < 0 || zona > 16) throw new RangeError('La zona quieta del QR debe ser un entero de 0 a 16.')
  const tamano = modulos.length
  const partes: string[] = []
  for (let y = 0; y < tamano; y++) {
    let x = 0
    while (x < tamano) {
      if (!modulos[y][x]) {
        x++
        continue
      }
      const desde = x
      while (x < tamano && modulos[y][x]) x++
      const largo = x - desde
      partes.push(`M${desde + zona} ${y + zona}h${largo}v1h-${largo}z`)
    }
  }
  const lado = tamano + 2 * zona
  return { path: partes.join(''), lado, viewBox: `0 0 ${lado} ${lado}` }
}
