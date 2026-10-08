export type RolPanel = 'miembro' | 'administrador' | 'superadmin'

export type ContextoPanelFixture = {
  es_superadmin: boolean
  organizacion_id: string | null
  organizacion_nombre: string | null
  rol_efectivo: 'miembro' | 'administrador' | null
  puede_escribir: boolean
  puede_copiar_identificador_tecnico: boolean
}

export const panelFixtures: Record<RolPanel, ContextoPanelFixture> = {
  miembro: {
    es_superadmin: false,
    organizacion_id: '11111111-1111-1111-1111-111111111111',
    organizacion_nombre: 'Estudio miembro',
    rol_efectivo: 'miembro',
    puede_escribir: false,
    puede_copiar_identificador_tecnico: false,
  },
  administrador: {
    es_superadmin: false,
    organizacion_id: '22222222-2222-2222-2222-222222222222',
    organizacion_nombre: 'Estudio administrador',
    rol_efectivo: 'administrador',
    puede_escribir: true,
    puede_copiar_identificador_tecnico: false,
  },
  superadmin: {
    es_superadmin: true,
    organizacion_id: null,
    organizacion_nombre: null,
    rol_efectivo: null,
    puede_escribir: false,
    puede_copiar_identificador_tecnico: true,
  },
}
