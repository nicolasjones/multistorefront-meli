import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// F-CLI-20 (FR-012, D-11): los favoritos son privados del cliente. Quien opera el panel no los ve: ni la ficha del cliente ni
// su historial los leen, y ninguna pantalla del panel llama a las RPC de favoritos (que son `publico.*`, solo de la tienda).
const RAIZ = join(__dirname, '../../..')

function archivos(directorio: string): string[] {
  return readdirSync(directorio).flatMap((nombre) => {
    const ruta = join(directorio, nombre)
    if (statSync(ruta).isDirectory()) return archivos(ruta)
    return /\.(tsx?|ts)$/.test(nombre) && !/\.test\./.test(nombre) ? [ruta] : []
  })
}

describe('los favoritos no existen en el panel (FR-012)', () => {
  const delPanel = [
    ...archivos(join(RAIZ, 'pages/clientes')),
    ...archivos(join(RAIZ, 'components/clientes')),
    join(RAIZ, 'lib/clientes.ts'),
    join(RAIZ, 'lib/cuentasCliente.ts'),
  ]

  it('la ficha y el historial del cliente del panel no mencionan favoritos', () => {
    expect(delPanel.length).toBeGreaterThan(3)
    const con = delPanel.filter((ruta) => /favorit/i.test(readFileSync(ruta, 'utf8')))
    expect(con).toEqual([])
  })

  it('solo la tienda pública usa las RPC de favoritos', () => {
    const todos = archivos(RAIZ).filter((ruta) => !/tienda-publica|tiendaCuentaDatos|useFavoritosEntre|useListadoPorCursor/.test(ruta))
    const con = todos.filter((ruta) => /(?:cambiar_favorito|mis_favoritos|favoritos_entre)_por_dominio/.test(readFileSync(ruta, 'utf8')))
    expect(con).toEqual([])
  })
})
