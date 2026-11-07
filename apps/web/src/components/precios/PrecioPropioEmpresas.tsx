import { type ChangeEvent, useState } from 'react'
import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEmpresas } from '../../hooks/useEmpresas'
import { usePreciosPropios } from '../../hooks/usePreciosPropios'
import { MONEDAS, type Moneda } from '../../lib/productos'
import { formatearPesosPrecio } from '../../lib/precios'
import {
  MARCA_PRECIO_PROPIO,
  type PrecioPropio,
  TEXTO_PRECIO_PROPIO,
  aTextoImporte,
  mensajeErrorPrecioPropio,
  validarPrecioPropio,
} from '../../lib/preciosPropios'

type Props = {
  productoId: string
  // Empresas a las que se vende el producto (F-CAT-07): una fila por cada una.
  empresaIds: readonly string[]
  soloLectura: boolean
}

type FilaProps = {
  empresaId: string
  nombre: string
  guardado: PrecioPropio | undefined
  neto: number | null | undefined
  soloLectura: boolean
  onFijar: (empresaId: string, moneda: Moneda, importe: number) => Promise<void>
  onQuitar: (empresaId: string) => Promise<void>
}

function FilaEmpresa({ empresaId, nombre, guardado, neto, soloLectura, onFijar, onQuitar }: FilaProps) {
  // Borrador del formulario: null = sin tocar (se muestra lo guardado).
  const [moneda, setMoneda] = useState<Moneda | null>(null)
  const [texto, setTexto] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupada, setOcupada] = useState(false)

  const monedaActual = moneda ?? guardado?.moneda ?? 'ARS'
  const textoActual = texto ?? (guardado ? aTextoImporte(guardado.importe) : '')
  const hayCambios = moneda !== null || texto !== null
  const idCampo = `precio-propio-${empresaId}`

  const guardar = async () => {
    const validado = validarPrecioPropio(textoActual)
    if ('error' in validado) {
      setError(validado.error)
      return
    }
    setError(null)
    setOcupada(true)
    try {
      await onFijar(empresaId, monedaActual, validado.importe)
      setMoneda(null)
      setTexto(null)
    } catch (excepcion) {
      console.error('No pudimos guardar el precio propio.', excepcion)
      setError(mensajeErrorPrecioPropio(excepcion))
    } finally {
      setOcupada(false)
    }
  }

  const quitar = async () => {
    setError(null)
    setOcupada(true)
    try {
      await onQuitar(empresaId)
      setMoneda(null)
      setTexto(null)
    } catch (excepcion) {
      console.error('No pudimos quitar el precio propio.', excepcion)
      setError(mensajeErrorPrecioPropio(excepcion, 'No pudimos quitar el precio propio. Probá de nuevo.'))
    } finally {
      setOcupada(false)
    }
  }

  const ejemplo = guardado && neto !== undefined ? (neto === null ? 'Neto: sin cotización' : `Neto sin IVA: ${formatearPesosPrecio(neto)}`) : undefined
  const ayuda = error ?? ejemplo ?? (guardado ? undefined : 'Sin precio propio: rige la regla de la empresa.')

  return (
    <Stack component="li" direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }} sx={{ listStyle: 'none' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: { md: 180 }, pt: { md: 1.5 } }}>
        <Typography variant="b" component="span">{nombre}</Typography>
        {guardado ? <Chip size="small" color="primary" label={MARCA_PRECIO_PROPIO} /> : null}
      </Stack>
      <TextField
        select
        label={`Moneda (${nombre})`}
        value={monedaActual}
        onChange={(evento: ChangeEvent<HTMLInputElement>) => setMoneda(evento.target.value as Moneda)}
        disabled={soloLectura || ocupada}
        sx={{ minWidth: 160 }}
      >
        {MONEDAS.map(({ valor, etiqueta }) => (
          <MenuItem key={valor} value={valor}>{etiqueta}</MenuItem>
        ))}
      </TextField>
      <TextField
        id={idCampo}
        label={`Precio propio (${nombre})`}
        value={textoActual}
        onChange={(evento: ChangeEvent<HTMLInputElement>) => {
          setTexto(evento.target.value)
          setError(null)
        }}
        error={Boolean(error)}
        helperText={ayuda}
        autoComplete="off"
        disabled={soloLectura || ocupada}
        slotProps={{ htmlInput: { inputMode: 'decimal' }, inputLabel: { shrink: true } }}
        sx={{ flex: 1 }}
      />
      {soloLectura ? null : (
        <Stack direction="row" spacing={1} sx={{ pt: { md: 0.5 } }}>
          <Button variant="contained" size="small" disabled={ocupada || !hayCambios} onClick={() => void guardar()} aria-label={`Guardar precio propio de ${nombre}`}>
            Guardar
          </Button>
          <Button size="small" color="inherit" disabled={ocupada || !guardado} onClick={() => void quitar()} aria-label={`Quitar precio propio de ${nombre}`}>
            Quitar
          </Button>
        </Stack>
      )}
    </Stack>
  )
}

// Bloque «Precio propio por empresa» de la ficha del producto (F-PRE-08, FR-018/FR-019). Una fila por empresa a la
// que se vende el producto: `Moneda`, `Precio propio` y «Quitar». Cada fila guarda por sí sola (la RPC es atómica e
// idempotente). Con lectura en Productos se ve sin poder editar. No depende de la empresa activa de la barra
// superior: la ficha edita todas las empresas del producto; al cambiar de producto el bloque se recarga entero.
export function PrecioPropioEmpresas({ productoId, empresaIds, soloLectura }: Props) {
  const { empresas, isLoading: cargandoEmpresas } = useEmpresas()
  const { precios, netos, cargando, hayError, fijar, quitar } = usePreciosPropios(productoId)
  const porEmpresa = new Map(precios.map((precio) => [precio.empresaId, precio]))
  // Una fila por empresa a la que se vende el producto Y por cada empresa que ya tenga un precio propio guardado:
  // si se quitó la empresa del producto, el precio propio sigue vigente en el cálculo y tiene que poder quitarse.
  const ids = new Set(empresaIds)
  const filas = empresas.filter((empresa) => ids.has(empresa.id) || porEmpresa.has(empresa.id))

  return (
    <Box component="section" aria-labelledby="precio-propio-titulo">
      <Typography id="precio-propio-titulo" variant="t3" component="h2">Precio propio por empresa</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{TEXTO_PRECIO_PROPIO}</Typography>
      {cargando || cargandoEmpresas ? (
        <Typography variant="b" color="text.secondary" sx={{ display: 'block', mt: 1 }} role="status">Cargando…</Typography>
      ) : hayError ? (
        <Alert severity="error" sx={{ mt: 1 }}>No pudimos cargar los precios propios. Recargá la página.</Alert>
      ) : filas.length === 0 ? (
        <Typography variant="b" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          El producto no se vende en ninguna empresa todavía: elegí las empresas arriba para fijar un precio propio.
        </Typography>
      ) : (
        <Stack component="ul" spacing={2} sx={{ m: 0, mt: 1.5, p: 0 }}>
          {filas.map((empresa) => (
            <FilaEmpresa
              // La clave incluye el producto: otra ficha nunca hereda un borrador.
              key={`${productoId}:${empresa.id}`}
              empresaId={empresa.id}
              nombre={empresa.nombre}
              guardado={porEmpresa.get(empresa.id)}
              neto={netos.get(empresa.id)}
              soloLectura={soloLectura}
              onFijar={fijar}
              onQuitar={quitar}
            />
          ))}
        </Stack>
      )}
    </Box>
  )
}
