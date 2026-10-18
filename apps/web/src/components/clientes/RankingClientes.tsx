import { useState, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Chip, FormControlLabel, LinearProgress, Link, Stack, Switch, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useRankingClientes, type FilaRanking } from '../../hooks/useRankingClientes'
import type { TipoCliente } from '../../lib/clientes'
import { formatearParticipacion, formatearPesos } from '../../lib/formatoRanking'
import { ATAJOS_PERIODO, rangoDeAtajo, validarRango, type AtajoPeriodo, type ErroresRango, type RangoFechas } from '../../lib/periodosRanking'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { BarraHerramientas } from '../pagina/BarraHerramientas'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 25
const ANCHO_CAMPO_FECHA = 170
const ANCHO_BARRA = 120
const ALTO_BARRA = 6
const PORCENTAJE_COMPLETO = 100
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const etiquetaTipo: Record<TipoCliente, string> = { minorista: 'Minorista', mayorista: 'Mayorista' }

// Solapa «Ranking por facturación» de Clientes (F-CLI-08). El período se edita
// en el formulario y recién se consulta al pulsar «Aplicar» (o un atajo); los
// filtros de tipo, Consumidor final y base con IVA se aplican al cambiarlos. La
// validación de fechas es de la pantalla y también del servidor.
export function RankingClientes() {
  const [borrador, setBorrador] = useState<RangoFechas>(() => rangoDeAtajo('este-mes'))
  const [aplicado, setAplicado] = useState<RangoFechas>(borrador)
  const [errores, setErrores] = useState<ErroresRango>({})
  const [tipo, setTipo] = useState<TipoCliente | null>(null)
  // Valor inicial provisorio de la spec (Decisiones 2): Consumidor final excluido.
  const [incluirConsumidorFinal, setIncluirConsumidorFinal] = useState(false)
  const [conIva, setConIva] = useState(false)
  const [pagina, setPagina] = useState(1)

  const { filas, total, isLoading, isFetching, isError, refetch } = useRankingClientes({
    desde: aplicado.desde, hasta: aplicado.hasta, tipo, incluirConsumidorFinal, conIva, pagina, tamano: TAMANO_PAGINA,
  })

  const aplicar = (rango: RangoFechas) => {
    const nuevos = validarRango(rango)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) return
    setAplicado(rango)
    setPagina(1)
  }

  const alEnviar = (evento: FormEvent) => {
    evento.preventDefault()
    aplicar(borrador)
  }

  const elegirAtajo = (atajo: AtajoPeriodo) => {
    const rango = rangoDeAtajo(atajo)
    setBorrador(rango)
    aplicar(rango)
  }

  // La barra es proporcional al primero de la página visible.
  const mayor = filas.reduce((maximo, fila) => Math.max(maximo, fila.participacion), 0)
  const baseIva = conIva ? 'con IVA' : 'sin IVA'

  const columnas: ColumnaAdaptable<FilaRanking>[] = [
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
    { clave: 'comprobantes', encabezado: 'Comprobantes', align: 'right', render: (fila) => fila.comprobantes },
    { clave: 'facturado', encabezado: `Facturado (${baseIva})`, align: 'right', render: (fila) => formatearPesos(fila.facturado) },
    {
      clave: 'participacion', encabezado: 'Participación', align: 'right',
      render: (fila) => (
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
          <LinearProgress
            variant="determinate"
            value={mayor > 0 ? (fila.participacion / mayor) * PORCENTAJE_COMPLETO : 0}
            aria-hidden
            sx={{ width: ANCHO_BARRA, height: ALTO_BARRA, borderRadius: 1 }}
          />
          <span>{formatearParticipacion(fila.participacion)}</span>
        </Stack>
      ),
    },
  ]

  return (
    <Stack spacing={2}>
      <Box component="form" onSubmit={alEnviar} noValidate aria-label="Período del ranking">
        <Stack direction="row" spacing={1.25} alignItems="flex-start" useFlexGap flexWrap="wrap">
          <TextField
            type="date" label="Desde" size="small" value={borrador.desde}
            onChange={(evento) => setBorrador((actual) => ({ ...actual, desde: evento.target.value }))}
            error={Boolean(errores.desde)} helperText={errores.desde}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ width: ANCHO_CAMPO_FECHA }}
          />
          <TextField
            type="date" label="Hasta" size="small" value={borrador.hasta}
            onChange={(evento) => setBorrador((actual) => ({ ...actual, hasta: evento.target.value }))}
            error={Boolean(errores.hasta)} helperText={errores.hasta}
            slotProps={{ inputLabel: { shrink: true } }} sx={{ width: ANCHO_CAMPO_FECHA }}
          />
          <Button type="submit" variant="contained" disabled={isFetching}>Aplicar</Button>
        </Stack>
      </Box>

      <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'cliente' : 'clientes'}`}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="group" aria-label="Atajos de período">
          {ATAJOS_PERIODO.map((atajo) => (
            <Button key={atajo.valor} size="small" variant="outlined" onClick={() => elegirAtajo(atajo.valor)}>{atajo.etiqueta}</Button>
          ))}
        </Stack>
        <ToggleButtonGroup
          exclusive size="small" aria-label="Filtrar ranking por tipo de cliente" value={tipo ?? 'todos'}
          onChange={(_, valor: string | null) => {
            if (valor === null) return
            setTipo(valor === 'todos' ? null : (valor as TipoCliente))
            setPagina(1)
          }}
        >
          <ToggleButton value="todos">Todos</ToggleButton>
          <ToggleButton value="minorista">Minorista</ToggleButton>
          <ToggleButton value="mayorista">Mayorista</ToggleButton>
        </ToggleButtonGroup>
        <FormControlLabel
          label="Consumidor final"
          control={<Switch checked={incluirConsumidorFinal} onChange={(evento) => { setIncluirConsumidorFinal(evento.target.checked); setPagina(1) }} />}
        />
        <FormControlLabel
          label="Ver con IVA"
          control={<Switch checked={conIva} onChange={(evento) => { setConIva(evento.target.checked); setPagina(1) }} />}
        />
      </BarraHerramientas>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
      </Box>
      {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando ranking" /> : null}

      <Box aria-busy={isFetching}>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar el ranking." reintentar={() => void refetch()} />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Sin facturación en el período" descripcion="Probá con otro rango de fechas." />
        ) : (
          <>
            <Typography variant="xs">Facturado {baseIva} del {aplicado.desde} al {aplicado.hasta}.</Typography>
            <ContenidoAdaptable
              items={filas}
              columnas={columnas}
              obtenerClave={(fila) => fila.cliente_id}
              etiquetaTabla="Ranking de clientes por facturación"
            />
            <TablePagination
              component="div" count={total} page={pagina - 1} rowsPerPage={TAMANO_PAGINA} rowsPerPageOptions={[TAMANO_PAGINA]}
              onPageChange={(_, nueva) => setPagina(nueva + 1)}
              labelRowsPerPage="Clientes por página"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
            />
          </>
        )}
      </Box>
    </Stack>
  )
}
