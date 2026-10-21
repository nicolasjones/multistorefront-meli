// Tipos del manifiesto `cobertura-e2e.json` (lo genera `scripts/cobertura-e2e.mjs`).
export type ItemEvidencia = {
  id: string
  hecho: boolean
  texto: string
  ambiguo: boolean
}

export type Evidencia = {
  epica: string
  epicaNombre: string
  /** Componente de la app (`**Componente**:` en el spec). Ausente en manifiestos viejos. */
  componente?: string
  spec: string
  specTitulo: string
  items: ItemEvidencia[]
  test: string
  archivo: string
  estado: 'pasado' | 'fallido' | 'omitido'
  video: string | null
}

export type ItemSinCubrir = {
  componente?: string
  spec: string
  specTitulo: string
  id: string
  hecho: boolean
  texto: string
}

export type ManifiestoCobertura = {
  run_id: string
  fecha: string
  modo: string
  evidencias: Evidencia[]
  huerfanos: Array<{ test: string; motivo: string }>
  sin_cubrir: ItemSinCubrir[]
}

/** Resumen de una épica dentro de su componente. */
export type EpicaResumen = {
  epica: string
  nombre: string
  componente: string
  /** Specs distintas citadas (cada una es una historia). */
  historias: number
  /** Ítems con E2E en verde. */
  cubiertos: number
  /** Ítems de la historia (cubiertos + sin cubrir). */
  total: number
  videos: number
  fallidos: number
  omitidos: number
}

/** Agrupación de primer nivel del visor. */
export type ComponenteResumen = {
  componente: string
  epicas: EpicaResumen[]
}

export type EstadoFiltro = 'todos' | 'cubierto' | 'parcial' | 'fallido'
