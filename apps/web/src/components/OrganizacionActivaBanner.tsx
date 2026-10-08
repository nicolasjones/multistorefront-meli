import { useState } from 'react'
import { Alert, Button } from '@mui/material'
import { useOrganizacionActiva } from '../hooks/useOrganizacionActiva'
import { supabaseClient } from '../lib/supabase'

// Indicador permanente de en qué organización está operando el superadmin
// (spec 004, US2, FR-004) + acción para salir (FR-005). No renderiza nada
// si no hay organización activa — eso incluye a administrador/miembro,
// que nunca tienen fila en superadmin_organizacion_activa y por lo tanto
// nunca ven este banner.
export function OrganizacionActivaBanner() {
  const { organizacionActiva, isLoading } = useOrganizacionActiva()
  const [saliendo, setSaliendo] = useState(false)

  if (isLoading || !organizacionActiva) {
    return null
  }

  const handleSalir = async () => {
    setSaliendo(true)
    // No hace falta chequear error: salir_de_organizacion es no-op si no
    // hay nada que borrar (Clarifications Q1) y solo rechaza a quien no
    // es superadmin, caso que no puede darse acá (el banner ya requiere
    // organizacionActiva !== null, que solo existe para un superadmin).
    await supabaseClient.rpc('salir_de_organizacion')
    // Recarga completa, no navigate() (mismo motivo que "Ingresar" en
    // organizaciones/list.tsx): el Sider cachea accessControlProvider.can
    // vía react-query y no se entera solo con una navegación de cliente.
    window.location.assign('/organizaciones')
  }

  return (
    <Alert
      severity="info"
      sx={{ mb: 2 }}
      action={
        <Button color="inherit" size="small" disabled={saliendo} onClick={handleSalir}>
          {saliendo ? 'Saliendo…' : 'Salir'}
        </Button>
      }
    >
      Operando en: <strong>{organizacionActiva.nombre}</strong>
    </Alert>
  )
}
