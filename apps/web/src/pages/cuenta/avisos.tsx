import { useState } from 'react'
import { Alert, Box, FormControlLabel, Paper, Stack, Switch, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { usePreferenciasAviso } from '../../hooks/usePreferenciasAviso'
import { MENSAJE_ERROR_CARGA_AVISOS } from '../../lib/avisos'

type Resultado = { tipo: 'exito' | 'error'; texto: string }

// «Avisos por correo» (F-NOT-01, FR-003/FR-005): un interruptor por tipo de aviso de las secciones a las
// que el usuario tiene acceso (la base filtra). Sin fila guardada el tipo aparece encendido. Los avisos
// de seguridad de la cuenta no son tipos configurables y no se listan. La preferencia es de la persona:
// no depende de la empresa activa de la barra superior (Principio VIII, declarado en la spec).
export function AvisosPage() {
  const { preferencias, cargando, hayError, guardando, recargar, cambiar } = usePreferenciasAviso()
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const alCambiar = async (tipo: string, nombre: string, activo: boolean) => {
    setResultado(null)
    const cambio = await cambiar(tipo, activo)
    if (!cambio) return
    setResultado(
      cambio.ok
        ? { tipo: 'exito', texto: `${activo ? 'Vas a recibir' : 'Dejaste de recibir'} los avisos de «${nombre}» por correo.` }
        : { tipo: 'error', texto: cambio.mensaje },
    )
  }

  return (
    <Box component="main" sx={{ maxWidth: 640, mx: 'auto', mt: 4, px: 2 }}>
      <EncabezadoPagina
        titulo="Avisos por correo"
        descripcion="Elegí qué avisos querés recibir por correo."
      />
      {cargando ? <EstadoCargaPagina lineas={2} /> : null}
      {hayError ? <EstadoError descripcion={MENSAJE_ERROR_CARGA_AVISOS} reintentar={() => void recargar()} /> : null}
      {preferencias && preferencias.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no tenés avisos para configurar"
          descripcion="Cuando tengas acceso a una sección que genere avisos, vas a poder elegirlos acá."
        />
      ) : null}
      {preferencias && preferencias.length > 0 ? (
        <Stack spacing={2}>
          {resultado ? (
            <Alert severity={resultado.tipo === 'exito' ? 'success' : 'error'} role={resultado.tipo === 'exito' ? 'status' : 'alert'}>
              {resultado.texto}
            </Alert>
          ) : null}
          <Paper variant="outlined" component="section" aria-label="Tipos de aviso" sx={{ p: 2 }}>
            <Stack spacing={1}>
              {preferencias.map((preferencia) => (
                <FormControlLabel
                  key={preferencia.tipo}
                  label={preferencia.nombre}
                  control={(
                    <Switch
                      checked={preferencia.activo}
                      disabled={guardando !== null}
                      onChange={(evento) => void alCambiar(preferencia.tipo, preferencia.nombre, evento.target.checked)}
                    />
                  )}
                />
              ))}
            </Stack>
          </Paper>
          <Typography variant="xs" color="text.secondary">
            Los correos de seguridad de tu cuenta, como el de recuperar la contraseña, se envían siempre.
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}
