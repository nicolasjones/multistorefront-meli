import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip } from '@mui/material'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useOrganizacionDeTrabajo } from '../../hooks/useOrganizacionDeTrabajo'
import { supabaseClient } from '../../lib/supabase'
import { conectarOAuth } from '../../providers/nango'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Integracion = { id: string; clave: string; nombre: string }
type Conexion = { id: string; integracion_id: string; estado: 'pendiente' | 'activa' | 'con_error'; updated_at: string }
type Fila = { integracion: Integracion; conexion: Conexion | null }

const ETIQUETA_ESTADO: Record<Conexion['estado'], string> = {
  pendiente: 'Pendiente',
  activa: 'Activa',
  con_error: 'Con error',
}

const COLOR_ESTADO: Record<Conexion['estado'], 'default' | 'success' | 'error'> = {
  pendiente: 'default',
  activa: 'success',
  con_error: 'error',
}

// Solo consulta metadatos permitidos por el contrato (contracts/conectar-oauth.md):
// ni un token ni un secreto de Nango o del proveedor pasan por esta pantalla.
export function ConexionOAuthList() {
  const { puedeEscribir, isLoading: checkingPermiso } = usePuedeEscribir()
  const { organizacionId, isLoading: checkingOrganizacion } = useOrganizacionDeTrabajo()
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conectandoId, setConectandoId] = useState<string | null>(null)
  const [errorPorIntegracion, setErrorPorIntegracion] = useState<Record<string, string>>({})

  const cargarFilas = useCallback(async () => {
    if (!organizacionId) return
    setCargando(true)
    setError(null)

    const [integracionesRes, conexionesRes] = await Promise.all([
      supabaseClient.from('integraciones_oauth').select('id, clave, nombre').eq('habilitada', true).order('nombre'),
      supabaseClient.from('conexiones_oauth').select('id, integracion_id, estado, updated_at').eq('organizacion_id', organizacionId),
    ])

    const primerError = integracionesRes.error ?? conexionesRes.error
    if (primerError) {
      setError(primerError.message)
      setCargando(false)
      return
    }

    const conexiones = (conexionesRes.data ?? []) as Conexion[]
    const nuevasFilas = ((integracionesRes.data ?? []) as Integracion[]).map((integracion) => ({
      integracion,
      conexion: conexiones.find((c) => c.integracion_id === integracion.id) ?? null,
    }))
    setFilas(nuevasFilas)
    setCargando(false)
  }, [organizacionId])

  useEffect(() => {
    cargarFilas()
  }, [cargarFilas])

  const conectar = async (integracion: Integracion) => {
    if (!organizacionId) return
    setConectandoId(integracion.id)
    setErrorPorIntegracion((actual) => ({ ...actual, [integracion.id]: '' }))

    const { data: conexion, error: iniciarError } = await supabaseClient
      .rpc('iniciar_conexion_oauth', { p_organizacion_id: organizacionId, p_integracion_id: integracion.id })
      .single<{ id: string }>()

    if (iniciarError || !conexion) {
      setErrorPorIntegracion((actual) => ({ ...actual, [integracion.id]: iniciarError?.message ?? 'No se pudo iniciar la conexión.' }))
      setConectandoId(null)
      return
    }

    const resultado = await conectarOAuth(integracion.clave, conexion.id)
    if (!resultado.exito) {
      setErrorPorIntegracion((actual) => ({ ...actual, [integracion.id]: resultado.motivo }))
      setConectandoId(null)
      return
    }

    const { error: confirmarError } = await supabaseClient.rpc('confirmar_conexion_oauth', {
      p_conexion_id: conexion.id,
      p_nango_connection_id: resultado.nangoConnectionId,
    })
    if (confirmarError) {
      setErrorPorIntegracion((actual) => ({ ...actual, [integracion.id]: confirmarError.message }))
    }

    setConectandoId(null)
    await cargarFilas()
  }

  if (checkingPermiso || checkingOrganizacion) return <EstadoCargaPagina />
  if (!puedeEscribir || !organizacionId) {
    return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador con una organización activa puede gestionar conexiones OAuth.</Alert>
  }

  const columnas: ColumnaAdaptable<Fila>[] = [
    { clave: 'integracion', encabezado: 'Proveedor', render: (fila) => fila.integracion.nombre },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (fila) => (fila.conexion ? <Chip size="small" color={COLOR_ESTADO[fila.conexion.estado]} label={ETIQUETA_ESTADO[fila.conexion.estado]} /> : <Chip size="small" label="No conectado" />),
    },
  ]

  return (
    <Box>
      <EncabezadoPagina titulo="Conexiones OAuth" descripcion="Conectá una cuenta externa con un login estándar de OAuth." contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {cargando ? (
          <EstadoCargaPagina />
        ) : error ? (
          <EstadoError descripcion={error} reintentar={cargarFilas} />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay proveedores OAuth habilitados para esta plataforma." />
        ) : (
          <ContenidoAdaptable
            items={filas}
            columnas={columnas}
            obtenerClave={(fila) => fila.integracion.id}
            etiquetaTabla="Conexiones OAuth"
            acciones={(fila) => (
              <Box sx={{ textAlign: 'right' }}>
                <Button
                  size="small"
                  variant={fila.conexion?.estado === 'activa' ? 'outlined' : 'contained'}
                  disabled={conectandoId === fila.integracion.id}
                  onClick={() => conectar(fila.integracion)}
                >
                  {conectandoId === fila.integracion.id
                    ? 'Conectando…'
                    : fila.conexion?.estado === 'activa'
                      ? 'Reautorizar'
                      : fila.conexion?.estado === 'con_error'
                        ? 'Reautorizar'
                        : 'Conectar'}
                </Button>
                {errorPorIntegracion[fila.integracion.id] && (
                  <Alert severity="error" sx={{ mt: 1 }}>{errorPorIntegracion[fila.integracion.id]}</Alert>
                )}
              </Box>
            )}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
