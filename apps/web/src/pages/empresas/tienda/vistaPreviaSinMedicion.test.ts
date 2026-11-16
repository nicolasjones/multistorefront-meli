import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// F-TDA-24 (FR-014, CA-TDA-24-2): la vista previa del panel NO mide. Se fija que ni ella ni la página que
// reutiliza (`PaginaTienda`) monten `MedicionTienda` ni emitan eventos: la medición solo vive en `LayoutTienda`,
// que es el front público publicado.
const leer = (ruta: string) => readFileSync(join(__dirname, ruta), 'utf8')

describe('la vista previa del panel no carga medición', () => {
  it.each([
    ['VistaPreviaTienda.tsx', './VistaPreviaTienda.tsx'],
    ['PaginaTienda.tsx', '../../tienda-publica/PaginaTienda.tsx'],
  ])('%s no usa MedicionTienda ni analiticaTienda', (_nombre, ruta) => {
    const fuente = leer(ruta)
    expect(fuente).not.toMatch(/MedicionTienda|analiticaTienda|registrarEventoTienda/)
  })

  it('LayoutTienda es el único que monta MedicionTienda', () => {
    expect(leer('../../tienda-publica/layout/LayoutTienda.tsx')).toMatch(/MedicionTienda/)
  })
})
