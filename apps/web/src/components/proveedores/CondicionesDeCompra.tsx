import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Dialog, DialogActions, DialogContent, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import {
  type CondicionesCompra,
  type ErroresCondiciones,
  type FormularioCondiciones,
  LARGO_NOTAS,
  MONEDAS_CONDICIONES,
  SIN_CONDICIONES,
  aFormularioCondiciones,
  esConflictoCondiciones,
  guardarCondiciones,
  leerCondiciones,
  mensajeErrorCondiciones,
  textoPlazo,
  validarCondiciones,
} from '../../lib/condicionesCompra'
import { formatearNumeroImporte } from '../../lib/formatoImporte'
import { supabaseClient } from '../../lib/supabase'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../estados/EstadosPagina'

type Props = {
  proveedorId: string
  // Editar solo con edición en Proveedores; la autoridad es la base.
  puedeEditar: boolean
}

// Sección «Condiciones de compra» de la ficha del proveedor (MSF-523): plazo de pago, mínimo de compra, moneda y notas. Se consulta
// aparte del resto de la ficha: un error acá no la afecta.
export function CondicionesDeCompra({ proveedorId, puedeEditar }: Props) {
  const [condiciones, setCondiciones] = useState<CondicionesCompra>(SIN_CONDICIONES)
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [editando, setEditando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const leidas = await leerCondiciones(supabaseClient, proveedorId)
      if (peticion === ultimaPeticion.current) setCondiciones(leidas)
    } catch (error) {
      console.error('No pudimos cargar las condiciones de compra.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [proveedorId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const textoMinimo = condiciones.minimoCompra === null
    ? '—'
    : `${condiciones.moneda ?? ''} ${formatearNumeroImporte(condiciones.minimoCompra, { centavos: 'siempre' })}`.trim()
  const datos: ReadonlyArray<[string, string]> = [
    ['Plazo de pago', textoPlazo(condiciones.plazoPagoDias)],
    ['Mínimo de compra', textoMinimo],
    ['Moneda', condiciones.moneda ?? '—'],
    ['Notas', condiciones.notas ?? '—'],
  ]

  return (
    <Box component="section" aria-labelledby="titulo-condiciones-compra" aria-busy={cargando}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography id="titulo-condiciones-compra" component="h2" variant="h6">Condiciones de compra</Typography>
        {puedeEditar && !cargando && !hayError ? (
          <Button variant="outlined" size="small" onClick={() => { setAviso(null); setEditando(true) }}>Editar condiciones</Button>
        ) : null}
      </Stack>
      {aviso ? <EstadoExito titulo={aviso} /> : null}
      {cargando ? (
        <EstadoCargaPagina />
      ) : hayError ? (
        <EstadoError descripcion="No pudimos cargar las condiciones de compra." reintentar={() => void cargar()} />
      ) : (
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '12rem 1fr' }, gap: 1 }}>
          {datos.map(([etiqueta, valor]) => (
            <Box key={etiqueta} sx={{ display: 'contents' }}>
              <Typography component="dt" color="text.secondary">{etiqueta}</Typography>
              <Typography component="dd" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{valor}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {editando ? (
        <DialogoCondiciones
          proveedorId={proveedorId}
          condiciones={condiciones}
          onCerrar={() => setEditando(false)}
          onGuardado={async () => {
            setEditando(false)
            await cargar()
            setAviso('Condiciones de compra guardadas')
          }}
          onRecargar={async () => {
            setEditando(false)
            await cargar()
          }}
        />
      ) : null}
    </Box>
  )
}

type PropsDialogo = {
  proveedorId: string
  condiciones: CondicionesCompra
  onCerrar: () => void
  onGuardado: () => Promise<void>
  onRecargar: () => Promise<void>
}

function DialogoCondiciones({ proveedorId, condiciones, onCerrar, onGuardado, onRecargar }: PropsDialogo) {
  const [formulario, setFormulario] = useState<FormularioCondiciones>(() => aFormularioCondiciones(condiciones))
  const [errores, setErrores] = useState<ErroresCondiciones>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  const cambiar = <C extends keyof FormularioCondiciones>(campo: C, valor: FormularioCondiciones[C]) =>
    setFormulario((actual) => ({ ...actual, [campo]: valor }))

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos = validarCondiciones(formulario)
    setErrores(nuevos)
    if (Object.keys(nuevos).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    try {
      await guardarCondiciones(supabaseClient, proveedorId, formulario, condiciones.actualizadoEn)
      await onGuardado()
    } catch (error) {
      setConflicto(esConflictoCondiciones(error))
      setErrorServidor(mensajeErrorCondiciones(error, 'No pudimos guardar las condiciones. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-condiciones-editar">
      <Box component="form" onSubmit={enviar} noValidate>
        <TituloDialogo id="titulo-condiciones-editar" onCerrar={guardando ? undefined : onCerrar}>Editar condiciones de compra</TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorServidor ? (
              <EstadoError
                titulo="No se guardaron las condiciones."
                descripcion={errorServidor}
                reintentar={conflicto ? () => void onRecargar() : undefined}
                etiquetaReintentar="Recargar condiciones"
              />
            ) : null}
            <TextField
              label="Plazo de pago (días)" autoFocus fullWidth autoComplete="off" inputMode="numeric"
              value={formulario.plazo} onChange={(e) => cambiar('plazo', e.target.value)}
              error={Boolean(errores.plazo)} helperText={errores.plazo ?? 'Opcional. 0 = contado.'}
            />
            <TextField
              label="Mínimo de compra" fullWidth autoComplete="off" inputMode="decimal"
              value={formulario.minimo} onChange={(e) => cambiar('minimo', e.target.value)}
              error={Boolean(errores.minimo)} helperText={errores.minimo ?? 'Opcional. Monto mínimo por pedido, sin IVA.'}
            />
            <TextField
              select label="Moneda" fullWidth
              value={formulario.moneda} onChange={(e) => cambiar('moneda', e.target.value as FormularioCondiciones['moneda'])}
              error={Boolean(errores.moneda)} helperText={errores.moneda ?? 'Obligatoria si cargás un mínimo de compra.'}
            >
              <MenuItem value="">Sin moneda</MenuItem>
              {MONEDAS_CONDICIONES.map((m) => <MenuItem key={m.valor} value={m.valor}>{m.etiqueta}</MenuItem>)}
            </TextField>
            <TextField
              label="Notas" fullWidth multiline minRows={3} autoComplete="off"
              value={formulario.notas} onChange={(e) => cambiar('notas', e.target.value)}
              error={Boolean(errores.notas)} helperText={errores.notas ?? `Opcional. Hasta ${LARGO_NOTAS} caracteres.`}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar condiciones'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
