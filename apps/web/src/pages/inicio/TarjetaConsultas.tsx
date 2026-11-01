import { useCallback } from 'react'
import { Link as RouterLink } from 'react-router'
import { Button, Stack, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { leerConsultasNuevas, pluralizar } from '../../lib/inicio'
import { TarjetaInicio } from './TarjetaInicio'
import { useLecturaInicio } from './useLecturaInicio'

// Consultas nuevas (FR-005): las `nueva` de `consultas_bandeja`, acotadas a la empresa activa de la barra
// superior (o todas, en «Todas mis empresas»), con enlace a la bandeja.
export function TarjetaConsultas() {
  const { empresaActivaId, isLoading } = useEmpresasAccesibles()
  const leer = useCallback(() => leerConsultasNuevas(empresaActivaId), [empresaActivaId])
  const { cargando, hayError, datos, recargar } = useLecturaInicio(leer, { habilitado: !isLoading })
  return (
    <TarjetaInicio titulo="Consultas nuevas" cargando={cargando} hayError={hayError} onReintentar={() => void recargar()}>
      {datos !== null ? (
        <Stack spacing={1} alignItems="flex-start">
          <Typography>{pluralizar(datos, 'consulta espera atención', 'consultas esperan atención')}</Typography>
          <Button component={RouterLink} to="/consultas" size="small" variant="outlined">Abrir consultas</Button>
        </Stack>
      ) : null}
    </TarjetaInicio>
  )
}
