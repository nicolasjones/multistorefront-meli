// Normaliza lo tipeado como lo hace la base (`private.normalizar_busqueda`): minúsculas, sin tildes y con los
// espacios colapsados. Se compara contra la columna calculada `nombre_norm` (MSF-722).
export function normalizarBusqueda(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}
