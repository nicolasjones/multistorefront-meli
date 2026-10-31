import { useCallback } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Button, List, ListItem, ListItemText } from '@mui/material'
import { EstadoVacio } from '../../components/estados/EstadosPagina'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import {
  ENLACE_ALERTA,
  alertasDemoradas,
  horaDeCalculo,
  leerAlertasInicio,
  leerUltimoCalculoAlertas,
  textoAlerta,
  type AlertaInicio,
  type TipoAlerta,
} from '../../lib/inicio'
import { TarjetaInicio } from './TarjetaInicio'
import { useLecturaInicio } from './useLecturaInicio'

const ACCION: Record<TipoAlerta, string> = {
  sin_stock: 'Ver',
  stock_bajo: 'Ver',
  consultas_sin_atender: 'Abrir',
  dolar_sin_cargar: 'Abrir',
  margen_negativo: 'Ver',
}

type Lectura = { alertas: AlertaInicio[]; ultimoCalculo: string | null }

// «Qué hacer hoy» (FR-025, FR-026, FR-024): alertas que calcula Kestra cada 15 minutos. La base decide qué ve
// cada rol (sección ≥ lectura y empresas accesibles); acá se muestran las de la empresa activa de la barra
// superior (o todas) con el enlace a la pantalla donde se resuelven, y se avisa si el cálculo está demorado.
export function AlertasInicio() {
  const { empresas, empresaActivaId, isLoading } = useEmpresasAccesibles()
  const leer = useCallback(async (): Promise<Lectura> => {
    const [alertas, ultimoCalculo] = await Promise.all([leerAlertasInicio(empresaActivaId), leerUltimoCalculoAlertas()])
    return { alertas, ultimoCalculo }
  }, [empresaActivaId])
  const { cargando, hayError, datos, recargar } = useLecturaInicio(leer, { habilitado: !isLoading })
  const ahora = new Date()
  const demorado = datos !== null && alertasDemoradas(datos.ultimoCalculo, ahora)
  const nombreEmpresa = (id: string | null) => (id ? empresas.find((empresa) => empresa.id === id)?.nombre : undefined)

  return (
    <TarjetaInicio titulo="Qué hacer hoy" cargando={cargando} hayError={hayError} onReintentar={() => void recargar()}>
      {datos !== null ? (
        <>
          {demorado ? (
            <Alert severity="warning" sx={{ mb: 1 }}>
              {datos.ultimoCalculo === null
                ? 'Todavía no se calcularon las alertas.'
                : `Las alertas se calcularon por última vez a las ${horaDeCalculo(datos.ultimoCalculo, ahora)} y pueden estar desactualizadas.`}
            </Alert>
          ) : null}
          {datos.alertas.length === 0 ? (
            demorado && datos.ultimoCalculo === null ? null : <EstadoVacio titulo="Sin alertas" descripcion="No hay nada pendiente por resolver." />
          ) : (
            <List disablePadding aria-label="Alertas">
              {datos.alertas.map((alerta) => {
                const empresa = nombreEmpresa(alerta.empresaId)
                const texto = textoAlerta(alerta.tipo, alerta.cantidad)
                return (
                  <ListItem
                    key={alerta.id}
                    disableGutters
                    secondaryAction={
                      <Button component={RouterLink} to={ENLACE_ALERTA[alerta.tipo]} size="small" variant="outlined" aria-label={`${ACCION[alerta.tipo]}: ${texto}`}>
                        {ACCION[alerta.tipo]}
                      </Button>
                    }
                  >
                    <ListItemText primary={texto} secondary={empresa} sx={{ pr: 8 }} />
                  </ListItem>
                )
              })}
            </List>
          )}
        </>
      ) : null}
    </TarjetaInicio>
  )
}
