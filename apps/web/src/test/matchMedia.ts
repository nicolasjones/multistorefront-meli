/** Simula `window.matchMedia` para que los tests de la versión móvil fuercen celular o escritorio. */
export function celular(activo: boolean) {
  window.matchMedia = ((consulta: string) => ({
    matches: activo, media: consulta, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
