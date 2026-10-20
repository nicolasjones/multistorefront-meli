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
  spec: string
  specTitulo: string
  items: ItemEvidencia[]
  test: string
  archivo: string
  estado: 'pasado' | 'fallido' | 'omitido'
  video: string | null
}

export type ItemSinCubrir = {
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

export type EpicaResumen = {
  epica: string
  nombre: string
  historias: number
  items: number
  videos: number
}
