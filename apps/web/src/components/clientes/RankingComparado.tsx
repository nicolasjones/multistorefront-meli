import { Link as RouterLink } from 'react-router'
import { Box, Chip, LinearProgress, Link, TablePagination, Typography } from '@mui/material'
import { useRankingComparado, type FilaRankingComparado } from '../../hooks/useRankingComparado'
import type { TipoCliente } from '../../lib/clientes'
import { formatearFecha, formatearParticipacion, formatearPesos } from '../../lib/formatoRanking'
import type { RangoFechas } from '../../lib/periodosRanking'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 25
const SIN_PORCENTAJE = '—'
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const etiquetaTipo: Record<TipoCliente, string> = { minorista: 'Minorista', mayorista: 'Mayorista' }

// Variación en pesos con signo explícito; el porcentaje es «—» sobre una base 0.
const formatearVariacion = (valor: number) =>
  valor > 0 ? `+${formatearPesos(valor)}` : valor < 0 ? `-${formatearPesos(Math.abs(valor))}` : formatearPesos(0)
const formatearVariacionPorcentaje = (valor: number | null) =>
  valor === null ? SIN_PORCENTAJE : `${valor > 0 ? '+' : ''}${formatearParticipacion(valor)}`

type Props = {
  aplicado: RangoFechas
  comparacion: RangoFechas
  tipo: TipoCliente | null
  incluirConsumidorFinal: boolean
  conIva: boolean
  /** Empresa activa: el padre remonta este componente al cambiarla (Principio VIII). */
  empresaId: string | null
  pagina: number
  alCambiarPagina: (pagina: number) => void
}

// Tabla de «Comparar con otro período» (F-CLI-14): por cliente, lo facturado en el
// período aplicado y en el de comparación, y la variación. Mismos filtros que el
// ranking básico; solo cambian las fechas.
export function RankingComparado({ aplicado, comparacion, tipo, incluirConsumidorFinal, conIva, empresaId, pagina, alCambiarPagina }: Props) {
  const { filas, total, isLoading, isFetching, isError, refetch } = useRankingComparado({
    desde: aplicado.desde, hasta: aplicado.hasta, desdeComparacion: comparacion.desde, hastaComparacion: comparacion.hasta,
    tipo, incluirConsumidorFinal, conIva, empresaId, pagina, tamano: TAMANO_PAGINA,
  })
  const baseIva = conIva ? 'con IVA' : 'sin IVA'

  const columnas: ColumnaAdaptable<FilaRankingComparado>[] = [
    { clave: 'posicion', encabezado: '#', render: (fila) => fila.posicion },
    {
      clave: 'cliente', encabezado: 'Cliente',
      render: (fila) => (
        <Link component={RouterLink} to={`/clientes/show/${fila.cliente_id}`} underline="hover" sx={{ fontWeight: 600 }}>
          {fila.nombre}
        </Link>
      ),
    },
    { clave: 'tipo', encabezado: 'Tipo', render: (fila) => <Chip size="small" label={etiquetaTipo[fila.tipo]} /> },
    { clave: 'facturado', encabezado: `Facturado (${baseIva})`, align: 'right', render: (fila) => formatearPesos(fila.facturado) },
    { clave: 'facturado_comparacion', encabezado: 'Facturado en la comparación', align: 'right', render: (fila) => formatearPesos(fila.facturado_comparacion) },
    { clave: 'variacion', encabezado: 'Variación ($)', align: 'right', render: (fila) => formatearVariacion(fila.variacion) },
    { clave: 'variacion_porcentaje', encabezado: 'Variación (%)', align: 'right', render: (fila) => formatearVariacionPorcentaje(fila.variacion_porcentaje) },
  ]

  return (
    <>
      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
      </Box>
      {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando comparación" /> : null}

      <Box aria-busy={isFetching}>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar la comparación." reintentar={() => void refetch()} />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Sin facturación en los períodos" descripcion="Probá con otros rangos de fechas." />
        ) : (
          <>
            <Typography variant="xs">
              Facturado {baseIva} del {formatearFecha(aplicado.desde)} al {formatearFecha(aplicado.hasta)}, comparado con el
              {' '}{formatearFecha(comparacion.desde)} al {formatearFecha(comparacion.hasta)}.
            </Typography>
            <ContenidoAdaptable
              items={filas}
              columnas={columnas}
              obtenerClave={(fila) => fila.cliente_id}
              etiquetaTabla="Comparación del ranking de clientes entre dos períodos"
            />
            <TablePagination
              component="div" count={total} page={pagina - 1} rowsPerPage={TAMANO_PAGINA} rowsPerPageOptions={[TAMANO_PAGINA]}
              onPageChange={(_, nueva) => alCambiarPagina(nueva + 1)}
              labelRowsPerPage="Clientes por página"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
            />
          </>
        )}
      </Box>
    </>
  )
}
