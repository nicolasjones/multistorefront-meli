import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Stack, TextField } from '@mui/material'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'

type Integracion = { id: string; clave: string; nombre: string; habilitada: boolean }

// Superadmin-only (Historia 4): alta y habilitación de proveedores OAuth en
// el catálogo de plataforma. No crea nada en Nango — eso se hace en su
// dashboard antes (infra/nango/README.md); acá solo se registra la clave
// (provider_config_key) que Nango ya conoce.
export function IntegracionOAuthAdministrar() {
  const { isSuperadmin, isLoading: checkingSuperadmin } = useIsSuperadmin()
  const [integraciones, setIntegraciones] = useState<Integracion[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clave, setClave] = useState('')
  const [nombre, setNombre] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [alternandoId, setAlternandoId] = useState<string | null>(null)

  const cargarIntegraciones = useCallback(async () => {
    setCargando(true)
    setError(null)
    const { data, error: queryError } = await supabaseClient.from('integraciones_oauth').select('id, clave, nombre, habilitada').order('nombre')
    if (queryError) setError(queryError.message)
    else setIntegraciones((data ?? []) as Integracion[])
    setCargando(false)
  }, [])

  useEffect(() => {
    if (isSuperadmin) cargarIntegraciones()
  }, [isSuperadmin, cargarIntegraciones])

  if (checkingSuperadmin) return <EstadoCargaPagina />
  if (!isSuperadmin) return <Alert severity="error" sx={{ m: 2 }}>Esta pantalla es solo para el superadmin de la plataforma.</Alert>

  const registrar = async (event: FormEvent) => {
    event.preventDefault()
    setGuardando(true)
    setError(null)
    const { error: rpcError } = await supabaseClient.rpc('registrar_integracion_oauth', { p_clave: clave, p_nombre: nombre })
    setGuardando(false)
    if (rpcError) { setError(rpcError.message); return }
    setClave('')
    setNombre('')
    await cargarIntegraciones()
  }

  const alternarHabilitada = async (integracion: Integracion) => {
    setAlternandoId(integracion.id)
    const { error: rpcError } = await supabaseClient.rpc('actualizar_integracion_oauth', {
      p_integracion_id: integracion.id,
      p_habilitada: !integracion.habilitada,
    })
    setAlternandoId(null)
    if (rpcError) { setError(rpcError.message); return }
    await cargarIntegraciones()
  }

  const columnas: ColumnaAdaptable<Integracion>[] = [
    { clave: 'nombre', encabezado: 'Nombre', render: (i) => i.nombre },
    { clave: 'clave', encabezado: 'Clave (provider_config_key)', render: (i) => i.clave },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (i) => <Chip size="small" color={i.habilitada ? 'success' : 'default'} label={i.habilitada ? 'Habilitada' : 'Deshabilitada'} />,
    },
  ]

  return (
    <Box>
      <EncabezadoPagina titulo="Integraciones OAuth" descripcion="Catálogo de proveedores OAuth disponibles para todos los productos derivados." />
      <ContenedorSeccion>
        <Box component="form" onSubmit={registrar} sx={{ mb: 3, maxWidth: 480 }}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Clave (provider_config_key en Nango)" value={clave} onChange={(e) => setClave(e.target.value)} required fullWidth helperText="Debe coincidir con la Integration ya creada en el dashboard de Nango." />
            <TextField label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required fullWidth />
            <Button type="submit" variant="contained" disabled={guardando} sx={{ alignSelf: 'flex-start' }}>
              {guardando ? 'Registrando…' : 'Registrar integración'}
            </Button>
          </Stack>
        </Box>

        {cargando ? (
          <EstadoCargaPagina />
        ) : integraciones.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay integraciones OAuth registradas." />
        ) : (
          <ContenidoAdaptable
            items={integraciones}
            columnas={columnas}
            obtenerClave={(i) => i.id}
            etiquetaTabla="Integraciones OAuth"
            acciones={(i) => (
              <Button size="small" disabled={alternandoId === i.id} onClick={() => alternarHabilitada(i)}>
                {alternandoId === i.id ? 'Actualizando…' : i.habilitada ? 'Deshabilitar' : 'Habilitar'}
              </Button>
            )}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
