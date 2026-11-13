// Aviso de cambio de empresa activa: las pantallas se reencuadran (datos,
// paginación, selección y diálogos). Ver constitución, Principio VIII.
let versionEmpresaActiva = 0
const oyentesEmpresaActiva = new Set<() => void>()

export function avisarCambioEmpresaActiva(): void {
  versionEmpresaActiva += 1
  for (const oyente of oyentesEmpresaActiva) oyente()
}

export function versionActualEmpresaActiva(): number {
  return versionEmpresaActiva
}

export function suscribirCambioEmpresaActiva(oyente: () => void): () => void {
  oyentesEmpresaActiva.add(oyente)
  return () => {
    oyentesEmpresaActiva.delete(oyente)
  }
}
