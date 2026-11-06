import { useSyncExternalStore } from 'react'

// F-TDA-22 (MSF-289, FR-034): decisión del visitante sobre las cookies de la tienda. La define el aviso
// (`AvisoCookies`) y la consume la analítica futura (F-TDA-24) sin tocar el banner. La decisión vive en
// `localStorage`; si no está disponible, el aviso reaparece y nada se rompe. Sin decisión equivale a rechazadas.

export type ConsentimientoCookies = 'aceptadas' | 'rechazadas'

export const CLAVE_CONSENTIMIENTO = 'tienda:consentimiento-cookies'
export const EVENTO_CONSENTIMIENTO = 'tienda:consentimiento-cookies'

const valido = (valor: unknown): valor is ConsentimientoCookies => valor === 'aceptadas' || valor === 'rechazadas'

// null = sin decisión (o almacenamiento bloqueado o con un valor ajeno).
export function leerConsentimiento(): ConsentimientoCookies | null {
  try {
    const valor = window.localStorage.getItem(CLAVE_CONSENTIMIENTO)
    return valido(valor) ? valor : null
  } catch {
    return null
  }
}

// Persiste la decisión (si se puede) y avisa a la ventana. Si el almacenamiento está bloqueado igual se emite el
// evento: la decisión rige durante la visita y el aviso vuelve a aparecer en la próxima.
let enMemoria: ConsentimientoCookies | null = null

export function guardarConsentimiento(valor: ConsentimientoCookies): void {
  enMemoria = valor
  try {
    window.localStorage.setItem(CLAVE_CONSENTIMIENTO, valor)
  } catch {
    // Almacenamiento bloqueado: la decisión queda solo en memoria.
  }
  window.dispatchEvent(new CustomEvent<ConsentimientoCookies>(EVENTO_CONSENTIMIENTO, { detail: valor }))
}

function instantanea(): ConsentimientoCookies | null {
  return leerConsentimiento() ?? enMemoria
}

function suscribir(avisar: () => void): () => void {
  window.addEventListener(EVENTO_CONSENTIMIENTO, avisar)
  window.addEventListener('storage', avisar)
  return () => {
    window.removeEventListener(EVENTO_CONSENTIMIENTO, avisar)
    window.removeEventListener('storage', avisar)
  }
}

export function useConsentimientoCookies(): ConsentimientoCookies | null {
  return useSyncExternalStore(suscribir, instantanea, () => null)
}

// Solo para pruebas: olvida la decisión en memoria.
export function reiniciarConsentimientoEnMemoria(): void {
  enMemoria = null
}
