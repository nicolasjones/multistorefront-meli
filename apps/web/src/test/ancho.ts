// Fija el ancho de ventana que ven `useMediaQuery` y `matchMedia` en jsdom (que no tiene layout): evalúa las consultas
// `(max-width:Npx)` y `(min-width:Npx)` contra `px`. Los tests de accesibilidad de la tienda recorren 320, 768 y 1440 px.
export const ANCHOS_TIENDA = [320, 768, 1440] as const

export function fijarAncho(px: number) {
  const evaluar = (consulta: string) => {
    const tope = /max-width:\s*([\d.]+)px/.exec(consulta)
    const piso = /min-width:\s*([\d.]+)px/.exec(consulta)
    if (tope && px > Number(tope[1])) return false
    if (piso && px < Number(piso[1])) return false
    return tope !== null || piso !== null
  }
  window.matchMedia = ((consulta: string) => ({
    matches: evaluar(consulta), media: consulta, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false,
  })) as typeof window.matchMedia
}
