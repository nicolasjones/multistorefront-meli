import { Link as RouterLink } from 'react-router'
import { Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { puedeVer } from '../../lib/inicio'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { TarjetaInicio } from './TarjetaInicio'

// Estado de las empresas (FR-003, decisión D-1): una fila por empresa que `empresas_accesibles()` le
// permite al usuario (el RPC del selector ya filtra), marcando la activa de la barra superior. Sin métricas
// de ventas (son de F-REP-05). El enlace a Empresas aparece solo con lectura en esa sección.
export function TarjetaEmpresas() {
  const { empresas, isLoading, isError, refetch } = useEmpresasAccesibles()
  const { nivel } = useNivelSeccion('empresas')
  return (
    <TarjetaInicio titulo="Tus empresas" cargando={isLoading && empresas.length === 0} hayError={isError} onReintentar={() => void refetch()}>
      {empresas.length === 0 ? (
        <Typography>Todavía no tenés empresas asignadas.</Typography>
      ) : (
        <Stack spacing={1} alignItems="flex-start">
          <List dense disablePadding sx={{ width: '100%' }} aria-label="Empresas accesibles">
            {empresas.map((empresa) => (
              <ListItem key={empresa.id} disableGutters secondaryAction={empresa.esActiva ? <EtiquetaEstado texto="Empresa activa" variante="exito" /> : undefined}>
                <ListItemText primary={empresa.nombre} />
              </ListItem>
            ))}
          </List>
          {puedeVer(nivel) ? <Button component={RouterLink} to="/empresas" size="small" variant="outlined">Ver empresas</Button> : null}
        </Stack>
      )}
    </TarjetaInicio>
  )
}
