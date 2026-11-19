import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// El default de `findBy*`/`waitFor` de Testing Library es 1 s: con la suite cargada (un worker por archivo, runners
// compartidos) una pantalla que solo tarda un poco más falla por timeout aunque la lógica esté bien (flake conocido:
// MisOpiniones «Cargar más» suma la siguiente tanda). 5 s solo afecta a los tests que fallan de verdad (un test que pasa
// no espera más) y no debilita ninguna aserción. Un archivo puede fijar otro valor con su propio `configure`.
configure({ asyncUtilTimeout: 5000 })
