import type { AccessControlProvider } from '@refinedev/core'
import { checkIsSuperadmin, checkOrganizacionActiva } from '../lib/superadmin'
import { checkFeatureHabilitada } from '../lib/features'
import { supabaseClient } from '../lib/supabase'
import { RECURSOS_DEPENDIENTES_DE_ORGANIZACION } from '../lib/recursosDependientesDeOrganizacion'
import { RECURSOS_CONDICIONADOS_A_FEATURE } from '../lib/recursosCondicionadosAFeature'

// Gatea tres categorías de recurso:
// - "organizaciones" (spec 003, US2/AC2, FR-008, FR-010),
//   "analitica-administrar" (spec 007, US1, FR-001/FR-013),
//   "features-administrar" (spec 009, US1, FR-002/FR-010) y "servidores"
//   (spec 013, US5, FR-014): solo superadmin, sin importar organización
//   activa — sus catálogos son globales.
// - RECURSOS_DEPENDIENTES_DE_ORGANIZACION (spec 004, FR-001/FR-002): para
//   administrador/miembro no cambia nada (siempre los ven); para
//   superadmin, solo si tiene una organización activa — si no, ni
//   aparecen en el menú, en vez de mostrar una pantalla vacía sin
//   contexto.
// - RECURSOS_CONDICIONADOS_A_FEATURE (spec 009, US2): la visibilidad
//   depende de que la organización efectiva del usuario tenga esa feature
//   habilitada — vacío por ahora, ninguna pantalla existente se conecta
//   todavía (Assumptions de spec.md).
// Sin esto, el Sider de @refinedev/mui muestra el ítem de menú a
// cualquier usuario autenticado aunque la pantalla en sí ya esté
// bloqueada — el navegar no debería ni ofrecer la opción.
export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource }) => {
    if (
      resource === 'organizaciones' ||
      resource === 'analitica-administrar' ||
      resource === 'features-administrar' ||
      resource === 'servidores' ||
      resource === 'ia'
    ) {
      const { data } = await supabaseClient.auth.getUser()
      if (!data?.user) {
        return { can: false }
      }

      return { can: await checkIsSuperadmin(data.user.id) }
    }

    const featureId = RECURSOS_CONDICIONADOS_A_FEATURE[resource ?? '']
    if (featureId) {
      return { can: await checkFeatureHabilitada(featureId) }
    }

    if ((RECURSOS_DEPENDIENTES_DE_ORGANIZACION as readonly string[]).includes(resource ?? '')) {
      const { data } = await supabaseClient.auth.getUser()
      if (!data?.user) {
        return { can: false }
      }

      const esSuperadmin = await checkIsSuperadmin(data.user.id)
      if (!esSuperadmin) {
        if (resource === 'miembros' || resource === 'conexiones') {
          const { data: membresia } = await supabaseClient
            .from('usuarios_organizacion')
            .select('rol_id')
            .eq('user_id', data.user.id)
            .maybeSingle()
          return { can: membresia?.rol_id === 'administrador' }
        }
        return { can: true }
      }

      const organizacionActiva = await checkOrganizacionActiva(data.user.id)
      return { can: organizacionActiva !== null }
    }

    return { can: true }
  },
}
