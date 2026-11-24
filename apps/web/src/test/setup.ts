import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { vi } from 'vitest'

// El default de `findBy*`/`waitFor` de Testing Library es 1 s: con la suite cargada (un worker por archivo, runners
// compartidos) una pantalla que solo tarda un poco más falla por timeout aunque la lógica esté bien (flake conocido:
// MisOpiniones «Cargar más» suma la siguiente tanda). 5 s solo afecta a los tests que fallan de verdad (un test que pasa
// no espera más) y no debilita ninguna aserción. Un archivo puede fijar otro valor con su propio `configure`.
configure({ asyncUtilTimeout: 5000 })

// `vi.waitFor` (de vitest, no de Testing Library) tiene su propio default de 1 s y `configure` no lo alcanza: los tests que lo
// usan fallaban por timeout bajo carga igual que los `findBy`. Se le da el mismo piso de 5 s cuando el test no fija uno
// explícito (un `timeout` propio, más largo o más corto a propósito, se respeta).
const esperaVitest = vi.waitFor.bind(vi)
vi.waitFor = ((callback: Parameters<typeof vi.waitFor>[0], opciones?: Parameters<typeof vi.waitFor>[1]) => {
  const propias = typeof opciones === 'number' ? { timeout: opciones } : (opciones ?? {})
  return esperaVitest(callback, { timeout: 5000, ...propias })
}) as typeof vi.waitFor
