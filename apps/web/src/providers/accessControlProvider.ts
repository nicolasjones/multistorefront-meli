import type { AccessControlProvider } from '@refinedev/core'
import { checkIsSuperadmin, checkOrganizacionActiva } from '../lib/superadmin'
import { checkFeatureHabilitada } from '../lib/features'
import { supabaseClient } from '../lib/supabase'
import { RECURSOS_DEPENDIENTES_DE_ORGANIZACION } from '../lib/recursosDependientesDeOrganizacion'
import { RECURSOS_CONDICIONADOS_A_FEATURE } from '../lib/recursosCondicionadosAFeature'
import {
  SECCION_POR_RECURSO,
  nivelDe,
  nivelPermiteAccionRefine,
  obtenerPermisosActualesCacheado,
  RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR,
} from '../lib/permisos'

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
  can: async ({ resource, action }) => {
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

    // F-ROL-01 (FR-005): recursos que son una sección de la matriz de
    // permisos por rol. Sin acceso → denegado (y fuera del menú); solo
    // lectura → list/show sí, create/edit/delete no. El superadmin sigue su
    // camino de abajo (opera la organización activa como administrador).
    const seccion = SECCION_POR_RECURSO[resource ?? '']
    if (seccion) {
      const { data } = await supabaseClient.auth.getUser()
      if (!data?.user) {
        return { can: false }
      }
      if (!(await checkIsSuperadmin(data.user.id))) {
        try {
          const nivel = nivelDe(await obtenerPermisosActualesCacheado(data.user.id), seccion)
          if (!nivelPermiteAccionRefine(nivel, action)) {
            return { can: false }
          }
          // RLS de escritura aún en puede_escribir() (solo administrador):
          // no ofrecer en la UI lo que la base rechazaría con 42501.
          if (
            RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR.includes(resource ?? '') &&
            action !== 'list' &&
            action !== 'show'
          ) {
            const { data: membresia } = await supabaseClient
              .from('usuarios_organizacion')
              .select('rol_id')
              .eq('user_id', data.user.id)
              .maybeSingle()
            if (membresia?.rol_id !== 'administrador') {
              return { can: false }
            }
          }
        } catch {
          return { can: false }
        }
      }
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
