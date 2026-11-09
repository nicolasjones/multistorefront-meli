// F-CFG-02 (MSF-385): contenido de ayuda estático por destino del menú (`SECCIONES_PANEL`). Sin tabla ni red: se versiona
// y se revisa en el PR, y no depende de la empresa activa.
export type ContenidoAyuda = {
  /** Nombre de la pantalla, tal como se ve en el menú. */
  titulo: string
  /** Para qué sirve la pantalla, en castellano y sin términos técnicos. */
  resumen: string
  /** Pasos o consejos principales (opcional). */
  pasos?: readonly string[]
}

/** Clave = `id` del destino en `SECCIONES_PANEL`. */
export type AyudaPorDestino = Readonly<Record<string, ContenidoAyuda>>

// Topes de brevedad (valores del plan; el test de contenidos los verifica).
export const AYUDA_MAX_RESUMEN = 600
export const AYUDA_MAX_PASOS = 5
export const AYUDA_MAX_PASO = 140
