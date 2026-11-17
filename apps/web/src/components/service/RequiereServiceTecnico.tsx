import type { ReactNode } from 'react'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useFeatureHabilitada } from '../../hooks/useFeatureHabilitada'
import { Button } from '@mui/material'
import { Link } from 'react-router'
import { ContenedorSeccion } from '../pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../pagina/EncabezadoPagina'
import { RequiereAccesoSeccion } from '../RequiereAccesoSeccion'
import { EstadoCargaPagina, EstadoVacio } from '../estados/EstadosPagina'

export const FUNCIONALIDAD_SERVICE_TECNICO = 'service-tecnico'

// FR-009: Service técnico se ofrece solo con la funcionalidad `service-tecnico` habilitada para la organización
// Y con acceso a la sección `service_tecnico`. Sin alguna de las dos → «Acceso restringido». Es defensa de UX: la
// autorización real de los datos es RLS (nivel de `service_tecnico`) en la base.
export function RequiereServiceTecnico({ children }: { children: ReactNode }) {
  return (
    <RequiereAccesoSeccion seccion="service_tecnico">
      <RequiereFuncionalidad>{children}</RequiereFuncionalidad>
    </RequiereAccesoSeccion>
  )
}

function RequiereFuncionalidad({ children }: { children: ReactNode }) {
  const { habilitada, isLoading } = useFeatureHabilitada(FUNCIONALIDAD_SERVICE_TECNICO)
  if (isLoading || habilitada === null) return <EstadoCargaPagina />
  // Falla cerrada: sin funcionalidad habilitada (o con error al consultarla) no se monta nada.
  if (!habilitada) return <FuncionalidadNoHabilitada />
  return <>{children}</>
}

// El permiso de la persona ya se validó arriba: lo que falta es la funcionalidad de la organización, así que el mensaje
// no habla del rol. Solo un superadmin la activa (Plataforma · Funcionalidades): al administrador se le dice que la pida
// a soporte; al resto, que se lo pida a un administrador de su organización.
function FuncionalidadNoHabilitada() {
  const { isSuperadmin } = useIsSuperadmin()
  const { puedeEscribir, isLoading } = usePuedeEscribir()
  // Mientras se resuelve el rol no se muestra ningún mensaje que dependa de él.
  if (isLoading || puedeEscribir === null) return <EstadoCargaPagina />
  const descripcion = isSuperadmin
    ? 'Activala para esta organización desde Plataforma · Funcionalidades.'
    : puedeEscribir
      ? 'Tu rol tiene acceso, pero la funcionalidad todavía no se activó para tu organización. La activa el soporte de la plataforma: pedísela indicando «Servicio técnico».'
      : 'La funcionalidad todavía no se activó para tu organización. Pedile a un administrador que gestione su habilitación con el soporte de la plataforma.'
  return (
    <>
      <EncabezadoPagina titulo="Servicio técnico" />
      <ContenedorSeccion>
        <EstadoVacio
          titulo="Servicio técnico no está habilitado para tu organización"
          descripcion={descripcion}
          accion={<Button color="inherit" component={Link} to="/">Volver al inicio</Button>}
        />
      </ContenedorSeccion>
    </>
  )
}
