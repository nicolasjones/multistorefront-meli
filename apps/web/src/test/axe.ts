import axe from 'axe-core'

// Corredor de axe para los tests de accesibilidad (SC-011). En jsdom no se puede
// evaluar el contraste real (no hay layout ni canvas), así que esa regla se omite;
// el resto de las violaciones se reportan con su regla y el nodo que las dispara.
export async function violacionesAxe(contenedor: HTMLElement): Promise<string[]> {
  const resultado = await axe.run(contenedor, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  })
  return resultado.violations.map(
    (violacion) => `${violacion.id}: ${violacion.nodes.map((nodo) => nodo.target.join(' ')).join(', ')}`,
  )
}
