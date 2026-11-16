import { FormControlLabel, Stack, Switch } from '@mui/material'
import { NOMBRE_REPORTE_RANKING_CLIENTES, urlParamsRanking, type RangoFechas } from '../../lib/ventas-reportes'
import { TableroReporte } from './TableroReporte'

type Props = {
  rango: RangoFechas
  empresaId: string | null
  empresaNombre: string | null
  // El filtro de empresa todavía está cargando: no se monta el tablero hasta saber la tienda
  // (si no, se pediría el token dos veces: una sin filtro y otra con la tienda activa).
  cargandoEmpresa: boolean
  // «Consumidor final» (excluido por defecto): lo maneja la pantalla porque el botón «Exportar a
  // Excel» del encabezado exporta el ranking con el mismo valor (FR-009).
  incluirConsumidorFinal: boolean
  onCambiarConsumidorFinal: (valor: boolean) => void
}

// «Ranking de clientes» (F-VTA-23, FR-008): el tablero del ranking de clientes por facturación con
// el interruptor «Consumidor final». El marco, el filtro de empresa y los filtros de período son
// los de F-VTA-22 (los reutiliza `TableroReporte`): el interruptor solo decide si el «Consumidor
// final» entra en el ranking.
//
// El «Consumidor final» arranca EXCLUIDO (FR-008): es el valor inicial del filtro nativo del
// tablero y el que manda la Decisión 2 de la spec. El interruptor viaja al tablero como filtro
// nativo (`NATIVE_FILTER-consumidor-final`): cambiarlo remonta el tablero con el filtro nuevo, así
// que nunca queda un ranking con el filtro anterior.
export function RankingClientes({
  rango,
  empresaId,
  empresaNombre,
  cargandoEmpresa,
  incluirConsumidorFinal,
  onCambiarConsumidorFinal,
}: Props) {
  return (
    <Stack spacing={2}>
      <FormControlLabel
        label="Consumidor final"
        control={
          <Switch
            checked={incluirConsumidorFinal}
            onChange={(evento) => onCambiarConsumidorFinal(evento.target.checked)}
          />
        }
      />
      <TableroReporte
        rango={rango}
        empresaId={empresaId}
        cargandoEmpresa={cargandoEmpresa}
        nombreReporte={NOMBRE_REPORTE_RANKING_CLIENTES}
        etiquetaReporte="Ranking de clientes"
        urlParams={urlParamsRanking({ rango, empresa: empresaNombre, incluirConsumidorFinal })}
      />
    </Stack>
  )
}
