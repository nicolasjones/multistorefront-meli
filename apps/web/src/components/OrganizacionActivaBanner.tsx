import { useEffect, useState } from 'react'
import { Alert, Button } from '@mui/material'
import { useOrganizacionActiva } from '../hooks/useOrganizacionActiva'
import { supabaseClient } from '../lib/supabase'
import { checkAccesoSoporte, formatearVencimiento } from '../lib/superadmin'

// Cierra el acceso (la RPC registra soporte.salida o soporte.vencido) y vuelve
// a Organizaciones. Recarga completa, no navigate() (mismo motivo que "Ingresar"
// en organizaciones/list.tsx): el Sider cachea accessControlProvider.can vía
// react-query y no se entera solo con una navegación de cliente.
async function cerrarAcceso(vencido: boolean) {
  await supabaseClient.rpc('salir_de_organizacion')
  window.location.assign(vencido ? '/organizaciones?acceso=vencido' : '/organizaciones')
}

// Indicador permanente de en qué organización está operando el superadmin
// (spec 004, US2, FR-004) + acción para salir (FR-005) + hasta cuándo vale el
// acceso de soporte (F-OPS-04, FR-018). Al vencer limpia el contexto y vuelve a
// Organizaciones con aviso. No renderiza nada si no hay organización activa —
// administrador/miembro nunca ven este banner.
export function OrganizacionActivaBanner() {
  const { organizacionActiva, isLoading } = useOrganizacionActiva()
  const [saliendo, setSaliendo] = useState(false)
  const [venceEn, setVenceEn] = useState<string | null>(null)
  const organizacionId = organizacionActiva?.id

  useEffect(() => {
    if (!organizacionId) {
      return
    }
    let cancelada = false
    void supabaseClient.auth.getUser().then(async ({ data }) => {
      const userId = data?.user?.id
      const acceso = userId ? await checkAccesoSoporte(userId) : null
      if (cancelada) return
      if (acceso) {
        setVenceEn(acceso.vence_en)
      } else if (userId) {
        // El contexto ya venció (o no se puede leer): se limpia y se avisa.
        await cerrarAcceso(true)
      }
    })
    return () => { cancelada = true }
  }, [organizacionId])

  useEffect(() => {
    if (!venceEn) {
      return
    }
    const espera = Math.max(new Date(venceEn).getTime() - Date.now(), 0)
    const temporizador = setTimeout(() => { void cerrarAcceso(true) }, espera)
    return () => clearTimeout(temporizador)
  }, [venceEn])

  if (isLoading || !organizacionActiva) {
    return null
  }

  const handleSalir = async () => {
    setSaliendo(true)
    // No hace falta chequear error: salir_de_organizacion es no-op si no
    // hay nada que borrar (Clarifications Q1) y solo rechaza a quien no
    // es superadmin, caso que no puede darse acá (el banner ya requiere
    // organizacionActiva !== null, que solo existe para un superadmin).
    await cerrarAcceso(false)
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
      {venceEn && <> · Acceso de soporte hasta {formatearVencimiento(venceEn)}</>}
    </Alert>
  )
}
