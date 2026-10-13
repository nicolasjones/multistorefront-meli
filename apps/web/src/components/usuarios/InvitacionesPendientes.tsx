import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, Typography } from '@mui/material'
import { type Invitacion, estaVencida, invocarInvitacion } from '../../lib/invitaciones'
import { nombreDeRol } from '../../lib/rolesUsuarios'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { type ColumnaAdaptable, ContenidoAdaptable } from '../pagina/ContenidoAdaptable'

type Props = { puedeGestionar: boolean; version?: number }

export function InvitacionesPendientes({ puedeGestionar, version = 0 }: Props) {
  const [invitaciones, setInvitaciones] = useState<Invitacion[]>([])
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabaseClient
      .from('invitaciones_organizacion')
      .select('id, email, rol_id, estado, vence_en')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false })
    if (error) { setErrorCarga(error.message); setCargando(false); return }
    setErrorCarga(null); setInvitaciones((data ?? []) as Invitacion[]); setCargando(false)
  }, [])

  useEffect(() => { if (puedeGestionar) void cargar() }, [cargar, puedeGestionar, version])

  if (!puedeGestionar) return null

  const ejecutar = async (invitacion: Invitacion, accion: 'reenviar' | 'cancelar') => {
    setTrabajando(invitacion.id); setErrorAccion(null); setAviso(null)
    const mensaje = await invocarInvitacion(
      accion === 'cancelar'
        ? { accion: 'cancelar', invitacion_id: invitacion.id }
        : { accion: 'invitar', email: invitacion.email, rol: invitacion.rol_id },
    )
    setTrabajando(null)
    if (mensaje) { setErrorAccion(mensaje); return }
    setAviso(accion === 'cancelar' ? 'Invitación cancelada.' : 'Invitación reenviada. Vence en 7 días.')
    await cargar()
  }

  const columnas: ColumnaAdaptable<Invitacion>[] = [
    { clave: 'email', encabezado: 'Correo', render: (invitacion) => invitacion.email },
    { clave: 'rol', encabezado: 'Rol', render: (invitacion) => nombreDeRol(invitacion.rol_id) },
    {
      clave: 'estado',
      encabezado: 'Estado',
      render: (invitacion) => estaVencida(invitacion)
        ? <Chip size="small" color="warning" label="Invitación vencida" />
        : <Chip size="small" label="Invitación pendiente" />,
    },
    { clave: 'vence', encabezado: 'Vence', render: (invitacion) => new Date(invitacion.vence_en).toLocaleDateString() },
  ]

  return (
    <Box component="section" aria-labelledby="titulo-invitaciones" sx={{ mb: 3 }}>
      <Typography id="titulo-invitaciones" component="h2" variant="h6" sx={{ mb: 1 }}>Invitaciones</Typography>
      {errorAccion && <Alert severity="error" sx={{ mb: 2 }}>{errorAccion}</Alert>}
      {aviso && <Alert severity="success" sx={{ mb: 2 }} role="status">{aviso}</Alert>}
      {cargando ? <EstadoCargaPagina lineas={1} />
        : errorCarga ? <EstadoError descripcion={errorCarga} reintentar={cargar} />
        : invitaciones.length === 0 ? <EstadoVacio titulo="No hay invitaciones pendientes." />
        : (
          <ContenidoAdaptable
            items={invitaciones}
            columnas={columnas}
            obtenerClave={(invitacion) => invitacion.id}
            etiquetaTabla="Invitaciones"
            acciones={(invitacion) => (
              <>
                <Button size="small" disabled={trabajando === invitacion.id} onClick={() => ejecutar(invitacion, 'reenviar')}>Reenviar</Button>
                <Button size="small" color="error" disabled={trabajando === invitacion.id} onClick={() => ejecutar(invitacion, 'cancelar')}>Cancelar</Button>
              </>
            )}
          />
        )}
    </Box>
  )
}
