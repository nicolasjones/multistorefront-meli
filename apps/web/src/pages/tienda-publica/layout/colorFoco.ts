import { contraste } from '../../../tema/temaTienda'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Color del contorno de foco (WCAG 1.4.11, ≥ 3:1 contra lo que lo rodea). Prefiere el primario de la tienda; si no llega a 3:1 contra el
// fondo de la página Y contra el blanco del encabezado y los campos, prueba el color del texto, el negro, el blanco y un gris medio, y si ninguno
// llega al mínimo elige el de mejor contraste mínimo. Mismo criterio que `textoSobre` (texto de la barra y botón del héroe).
export function colorFoco(primario: string, texto: string, fondo: string): string {
  // El gris medio #767676 (4,5:1 sobre blanco y 3,3:1 sobre #1A1A1A) resuelve el caso de una página oscura con encabezado blanco.
  const candidatos = [primario, texto, '#000000', '#FFFFFF', '#767676'].filter((c) => HEX.test(c)) // estilos-sueltos: ok
  if (!HEX.test(fondo) || candidatos.length === 0) return primario
  const peor = (c: string) => Math.min(contraste(c, fondo), contraste(c, '#FFFFFF')) // estilos-sueltos: ok
  const bueno = candidatos.find((c) => peor(c) >= 3)
  return bueno ?? candidatos.reduce((mejor, c) => (peor(c) > peor(mejor) ? c : mejor))
}
