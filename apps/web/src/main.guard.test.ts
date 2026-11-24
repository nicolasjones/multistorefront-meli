import { describe, expect, it } from 'vitest'
import main from './main.tsx?raw'

// FR-047 / SC-009: el visitante de la tienda no puede pagar el bundle del panel
// administrativo. Antes `main.tsx` importaba `App.tsx` (Refine, X Charts, Nango y ~55 pantallas)
// de forma estática: el chunk de entrada del front público era de 853 kB y, con «4G lento» y
// CPU ×4, el LCP de la home rondaba los 17 s. Este test falla si esa importación vuelve a ser
// estática.
describe('el panel no viaja en el bundle de la tienda (FR-047)', () => {
  it('el panel se carga de forma diferida', () => {
    expect(main).toContain("const App = lazy(() => import('./App.tsx'))")
  })

  it('no hay importación estática del panel', () => {
    expect(main).not.toMatch(/^\s*import\s+App\s+from\s+['"]\.\/App\.tsx['"]/m)
  })

  it('el panel se monta dentro de un Suspense con un estado de carga', () => {
    expect(main).toContain('<Suspense fallback={<EstadoCargaPagina />}>')
  })
})
