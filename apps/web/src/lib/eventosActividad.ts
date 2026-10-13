// Contrato de eventos de actividad hacia el registro F-AUD-01 (Plataforma).
// Esa épica todavía no existe: acá solo se define la forma del evento y el
// punto de emisión. Cuando F-AUD-01 llegue, registra su destino con
// `registrarDestinoActividad` y no hace falta tocar a quien emite (FR-010).
export type CambioActividad = { campo: string; antes: string | null; despues: string | null }

export type EventoActividad = {
  tipo: 'empresa.actualizada'
  actorId: string | null
  empresaId: string
  cambios: CambioActividad[]
  fecha: string
}

type DestinoActividad = (evento: EventoActividad) => void | Promise<void>

let destino: DestinoActividad | null = null

export function registrarDestinoActividad(nuevoDestino: DestinoActividad | null) {
  destino = nuevoDestino
}

// La actividad es secundaria al guardado: un destino que falle no debe romper
// ni revertir la edición ya persistida.
export async function emitirEventoActividad(evento: EventoActividad) {
  if (!destino) return
  try {
    await destino(evento)
  } catch (excepcion) {
    // no rompe el guardado, pero deja rastro para depurar el destino
    console.warn('El destino de actividad falló', excepcion)
  }
}

export function calcularCambios<T extends Record<string, string | null>>(antes: T, despues: T): CambioActividad[] {
  return (Object.keys(despues) as (keyof T & string)[])
    .filter((campo) => antes[campo] !== despues[campo])
    .map((campo) => ({ campo, antes: antes[campo], despues: despues[campo] }))
}
