import { useCallback, useEffect, useState } from 'react'
import { CreateButton, EditButton } from '@refinedev/mui'
import { Alert, Box } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Conexion = { id: string; sistema_externo: string; estado: 'activa' | 'error' | 'credencial_invalida'; created_at: string }

const columnas: ColumnaAdaptable<Conexion>[] = [
  { clave: 'sistema', encabezado: 'Sistema externo', render: (conexion) => conexion.sistema_externo },
  { clave: 'estado', encabezado: 'Estado', render: (conexion) => conexion.estado },
  { clave: 'alta', encabezado: 'Alta', render: (conexion) => new Date(conexion.created_at).toLocaleString() },
]

// Solo selecciona metadatos permitidos por el contrato; ni la credencial ni su
// identificador de Vault participan de esta consulta o de la UI.
export function ConexionList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [conexiones, setConexiones] = useState<Conexion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargarConexiones = useCallback(() => {
    if (!organizacionId) return
    setCargando(true)
    setError(null)
    let cancelled = false
    supabaseClient.from('conexiones').select('id, sistema_externo, estado, created_at').eq('organizacion_id', organizacionId).order('created_at', { ascending: false }).then(({ data, error: queryError }) => {
      if (cancelled) return
      if (queryError) setError(queryError.message)
      else setConexiones((data ?? []) as Conexion[])
      setCargando(false)
    })
    return () => { cancelled = true }
  }, [organizacionId])

  useEffect(() => cargarConexiones(), [cargarConexiones])

  if (checkingPermiso || checkingOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId) return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede gestionar conexiones.</Alert>

  return (
    <Box>
      <EncabezadoPagina titulo="Conexiones" accion={puedeEscribir ? <CreateButton /> : undefined} contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {cargando ? (
          <EstadoCargaPagina />
        ) : error ? (
          <EstadoError descripcion={error} reintentar={cargarConexiones} />
        ) : conexiones.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay conexiones configuradas para esta organización." />
        ) : (
          <ContenidoAdaptable
            items={conexiones}
            columnas={columnas}
            obtenerClave={(conexion) => conexion.id}
            etiquetaTabla="Conexiones"
            acciones={(conexion) => <EditButton hideText recordItemId={conexion.id} />}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
