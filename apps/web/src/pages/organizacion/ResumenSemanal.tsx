import { useCallback, useEffect, useState } from 'react'
import { Box, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError } from '../../components/estados/EstadosPagina'
import { supabaseClient } from '../../lib/supabase'
import { textoProximoEnvio, textoUltimoResumen, type EstadoResumen } from '../../lib/resumenSemanal'

type Carga = { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'listo'; estado: EstadoResumen }

// «Resumen semanal por correo» (F-REP-08, MSF-265) en Mi organización: la organización activa o pausa el correo que reciben
// sus administradores los lunes 08:00 (hora de Buenos Aires). Solo administradores (la pantalla ya lo exige y las RPC
// `estado_resumen_semanal` / `configurar_resumen_semanal` lo vuelven a exigir); cada cambio queda en Actividad.
// Empresa activa: no aplica (el resumen es de toda la organización). Cada persona puede además darse de baja en «Avisos por correo».
export function ResumenSemanalOrganizacion() {
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' })
  const [guardando, setGuardando] = useState(false)
  const [errorCambio, setErrorCambio] = useState(false)

  // `silencioso`: refresco tras un cambio. No pasa por «cargando» (eso desmontaría el interruptor y le sacaría el foco al
  // teclado): se actualiza el estado en el lugar y, si el refresco falla, se conserva lo que ya se veía.
  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarga({ tipo: 'cargando' })
    try {
      const { data, error } = await supabaseClient.rpc('estado_resumen_semanal')
      const fila = Array.isArray(data) ? (data[0] as EstadoResumen | undefined) : undefined
      if (error || !fila) {
        if (!silencioso) setCarga({ tipo: 'error' })
        else setErrorCambio(true)
        return
      }
      setCarga({ tipo: 'listo', estado: fila })
    } catch {
      if (!silencioso) setCarga({ tipo: 'error' })
      else setErrorCambio(true)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiar = async (activo: boolean) => {
    if (guardando) return
    setGuardando(true)
    setErrorCambio(false)
    try {
      const { error } = await supabaseClient.rpc('configurar_resumen_semanal', { p_activo: activo })
      if (error) {
        setErrorCambio(true)
        return
      }
      await cargar(true)
    } catch {
      setErrorCambio(true)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Box component="section" aria-labelledby="resumen-semanal-titulo" sx={{ maxWidth: 560 }}>
      <Typography id="resumen-semanal-titulo" component="h2" variant="h6" sx={{ mb: 1 }}>Resumen semanal por correo</Typography>
      {carga.tipo === 'cargando' ? (
        <EstadoCargaPagina lineas={2} etiqueta="Cargando el resumen semanal" />
      ) : carga.tipo === 'error' ? (
        <EstadoError descripcion="No pudimos cargar el estado del resumen semanal." reintentar={() => void cargar()} />
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            Los administradores reciben cada lunes a las 08:00 (hora de Buenos Aires) un correo con las ventas de la semana,
            el margen, el stock en alerta y los faltantes pendientes. Cada persona puede darse de baja desde «Avisos por correo».
          </Typography>
          <FormControlLabel
            control={(
              <Switch
                checked={carga.estado.activo}
                // Sin `disabled` mientras guarda: un control con el foco que se deshabilita lo pierde (`cambiar` ya ignora el doble clic).
                slotProps={{ input: { 'aria-busy': guardando } }}
                onChange={(event) => void cambiar(event.target.checked)}
              />
            )}
            label={carga.estado.activo ? 'Resumen semanal activo' : 'Resumen semanal pausado'}
          />
          <Typography variant="body2">
            {carga.estado.activo
              ? `Próximo envío: ${textoProximoEnvio(carga.estado.proximo_envio)}, a ${carga.estado.destinatarios} ${carga.estado.destinatarios === 1 ? 'administrador' : 'administradores'}.`
              : 'No se envía ningún resumen hasta que lo reactives.'}
          </Typography>
          <Typography variant="body2" color="text.secondary">{textoUltimoResumen(carga.estado)}</Typography>
          {errorCambio ? <EstadoError titulo="No se guardó el cambio." descripcion="Probá de nuevo." /> : null}
        </Stack>
      )}
    </Box>
  )
}
