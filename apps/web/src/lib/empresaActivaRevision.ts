// Señal de «cambió la empresa activa» (F-ROL-06). El selector de la barra
// superior y las pantallas que filtran por tienda (`useEmpresasAccesibles`)
// leen el mismo RPC (`empresas_para_selector()`) en instancias separadas; sin
// esta señal, la pantalla no se enteraba de un cambio hecho en la barra salvo
// que cambiara de organización o se remontara. Es un store mínimo para
// `useSyncExternalStore`.
let revision = 0
const suscriptores = new Set<() => void>()

export function notificarEmpresaActivaCambiada(): void {
  revision += 1
  for (const suscriptor of suscriptores) suscriptor()
}

export function suscribirEmpresaActiva(suscriptor: () => void): () => void {
  suscriptores.add(suscriptor)
  return () => {
    suscriptores.delete(suscriptor)
  }
}

export function revisionEmpresaActiva(): number {
  return revision
}
