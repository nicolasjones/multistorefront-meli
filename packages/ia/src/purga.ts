export type EvidenciaPendiente = { interaccionId: string; evidenciaPath: string }
export type RepositorioPurgaIa = {
  evidenciasPendientes: (hasta: Date) => Promise<EvidenciaPendiente[]>
  eliminarEvidencia: (path: string) => Promise<void>
  finalizarPurga: (interacciones: string[]) => Promise<number>
}

// El borrado físico se delega a Storage API. Cada evidencia se intenta por separado: un borrado fallido no frena el
// resto de la tanda. Solo se confirman los metadatos de las que sí se borraron; las fallidas quedan pendientes para el
// siguiente ciclo (reintento seguro) y, si hubo alguna, la purga termina con error para que el llamador lo vea.
export async function purgarEvidenciasVencidas(repositorio: RepositorioPurgaIa, hasta = new Date()): Promise<number> {
  const pendientes = await repositorio.evidenciasPendientes(hasta)
  const eliminadas: string[] = []
  const errores: unknown[] = []
  for (const evidencia of pendientes) {
    try {
      await repositorio.eliminarEvidencia(evidencia.evidenciaPath)
      eliminadas.push(evidencia.interaccionId)
    } catch (error) {
      errores.push(error)
    }
  }
  const confirmadas = eliminadas.length === 0 ? 0 : await repositorio.finalizarPurga(eliminadas)
  if (errores.length > 0) {
    const primero = errores[0] instanceof Error ? errores[0].message : String(errores[0])
    throw new AggregateError(errores, `PURGA_PARCIAL: ${errores.length} de ${pendientes.length} evidencias no se pudieron borrar (${confirmadas} confirmadas; primer error: ${primero})`)
  }
  return confirmadas
}
