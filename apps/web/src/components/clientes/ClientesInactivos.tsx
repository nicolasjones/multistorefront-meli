import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Chip, FormControlLabel, LinearProgress, Link, Stack, Switch, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useClientesInactivos, type FilaInactivo } from '../../hooks/useClientesInactivos'
import type { TipoCliente } from '../../lib/clientes'
import { validarDias } from '../../lib/diasInactivos'
import { formatearFecha, formatearPesos } from '../../lib/formatoRanking'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../estados/EstadosPagina'
import { BarraHerramientas } from '../pagina/BarraHerramientas'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

const TAMANO_PAGINA = 25
const DIAS_POR_DEFECTO = 90
const ATAJOS_DIAS = [30, 60, 90, 180] as const
const ANCHO_CAMPO_DIAS = 190
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const etiquetaTipo: Record<TipoCliente, string> = { minorista: 'Minorista', mayorista: 'Mayorista' }

// Contenido de la solapa «Clientes inactivos» de Clientes (F-CLI-16). El umbral se
// edita en el campo y recién se consulta al pulsar «Aplicar» (o un atajo); Tipo y
// Consumidor final se aplican al cambiarlos. La tienda la fija la empresa activa.
export function ClientesInactivos({ empresaId = null }: { empresaId?: string | null }) {
  const [borrador, setBorrador] = useState(String(DIAS_POR_DEFECTO))
  const [aplicado, setAplicado] = useState(DIAS_POR_DEFECTO)
  const [error, setError] = useState<string | undefined>()
  const [tipo, setTipo] = useState<TipoCliente | null>(null)
  const [incluirConsumidorFinal, setIncluirConsumidorFinal] = useState(false)
  const [pagina, setPagina] = useState(1)

  const { filas, total, isLoading, isFetching, isError, refetch } = useClientesInactivos({
    dias: aplicado, tipo, incluirConsumidorFinal, empresaId, pagina, tamano: TAMANO_PAGINA,
  })

  // Cambió la empresa activa: se reencuadra a la primera página (Principio VIII).
  useEffect(() => { setPagina(1) }, [empresaId])

  const aplicar = (texto: string) => {
    const validado = validarDias(texto)
    if ('error' in validado) {
      setError(validado.error)
      return
    }
    setError(undefined)
    setAplicado(validado.dias)
    setPagina(1)
  }

  const alEnviar = (evento: FormEvent) => {
    evento.preventDefault()
    aplicar(borrador)
  }

  const elegirAtajo = (dias: number) => {
    setBorrador(String(dias))
    aplicar(String(dias))
  }

  const columnas: ColumnaAdaptable<FilaInactivo>[] = [
    {
      clave: 'cliente', encabezado: 'Cliente',
      render: (fila) => (
        <Link component={RouterLink} to={`/clientes/show/${fila.cliente_id}`} underline="hover" sx={{ fontWeight: 600 }}>
          {fila.nombre}
        </Link>
      ),
    },
    { clave: 'tipo', encabezado: 'Tipo', render: (fila) => <Chip size="small" label={etiquetaTipo[fila.tipo]} /> },
    { clave: 'ultima', encabezado: 'Última compra', render: (fila) => formatearFecha(fila.ultima_compra) },
    { clave: 'dias', encabezado: 'Días sin comprar', align: 'right', render: (fila) => fila.dias_sin_comprar },
    { clave: 'comprobantes', encabezado: 'Comprobantes', align: 'right', render: (fila) => fila.comprobantes },
    { clave: 'facturado', encabezado: 'Facturado histórico', align: 'right', render: (fila) => formatearPesos(fila.facturado) },
  ]

  return (
    <Stack spacing={2}>
      <Box component="form" onSubmit={alEnviar} noValidate aria-label="Plazo sin comprar">
        <Stack direction="row" spacing={1.25} alignItems="flex-start" useFlexGap flexWrap="wrap">
          <TextField
            label="Días sin comprar" size="small" value={borrador} sx={{ width: ANCHO_CAMPO_DIAS }}
            onChange={(evento) => setBorrador(evento.target.value)}
            error={Boolean(error)} helperText={error}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <Button type="submit" variant="contained" disabled={isFetching}>Aplicar</Button>
        </Stack>
      </Box>

      <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'cliente' : 'clientes'}`}>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" role="group" aria-label="Atajos de días sin comprar">
          {ATAJOS_DIAS.map((dias) => (
            <Button key={dias} size="small" variant="outlined" onClick={() => elegirAtajo(dias)}>{dias} días</Button>
          ))}
        </Stack>
        <ToggleButtonGroup
          exclusive size="small" aria-label="Filtrar clientes inactivos por tipo de cliente" value={tipo ?? 'todos'}
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
      </BarraHerramientas>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
      </Box>
      {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando clientes inactivos" /> : null}

      <Box aria-busy={isFetching}>
        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar los clientes inactivos." reintentar={() => void refetch()} />
        ) : filas.length === 0 ? (
          <EstadoVacio titulo="Ningún cliente dejó de comprar en ese plazo." descripcion="Probá con un plazo más corto." />
        ) : (
          <>
            <Typography variant="xs">Clientes cuya última compra fue hace más de {aplicado} días. Facturado histórico sin IVA, neto de notas de crédito.</Typography>
            <ContenidoAdaptable
              items={filas}
              columnas={columnas}
              obtenerClave={(fila) => fila.cliente_id}
              etiquetaTabla="Clientes inactivos"
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
