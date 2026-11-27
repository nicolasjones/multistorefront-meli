import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import {
  Autocomplete, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, FormControlLabel,
  Stack, TextField, Typography,
} from '@mui/material'
import { useProveedoresBasico } from '../../hooks/useProveedoresBasico'
import { formatearNumeroImporte } from '../../lib/formatoImporte'
import {
  type ErroresVinculo,
  type FormularioVinculo,
  type ProveedorDeProducto,
  LARGO_CODIGO_PROVEEDOR,
  aFormularioVinculo,
  asignarProveedorProducto,
  leerProveedoresDeProducto,
  marcarProveedorPrincipal,
  mensajeErrorProveedoresProducto,
  quitarProveedorProducto,
  validarVinculo,
} from '../../lib/productosProveedores'
import { supabaseClient } from '../../lib/supabase'
import { EtiquetaEstado } from '../base/EtiquetaEstado'
import { TituloDialogo } from '../base/TituloDialogo'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../estados/EstadosPagina'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../pagina/ContenidoAdaptable'

type Props = {
  productoId: string
  moneda: string
  // Agregar, editar, quitar y marcar principal solo con edición en Productos; la autoridad es la base.
  puedeEditar: boolean
  // El costo se ve con Rentabilidad y se edita solo con edición en Rentabilidad.
  veCosto: boolean
  editaCosto: boolean
  // Tras un cambio el producto cambió (proveedor principal, costo): quien lo muestra debe recargarlo.
  onCambiado?: () => void
}

type Edicion = { vinculo: ProveedorDeProducto | null }

// Sección «Proveedores del producto» de la edición del producto (MSF-530): todos los proveedores con su código y su costo, uno principal.
// El principal es el del selector «Proveedor» del formulario; los cambios de esta sección se guardan al instante.
export function ProveedoresDelProducto({ productoId, moneda, puedeEditar, veCosto, editaCosto, onCambiado }: Props) {
  const [vinculos, setVinculos] = useState<ProveedorDeProducto[]>([])
  const [cargando, setCargando] = useState(true)
  const [hayError, setHayError] = useState(false)
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [quitando, setQuitando] = useState<ProveedorDeProducto | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)
  const enVuelo = useRef(false)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setHayError(false)
    try {
      const leidos = await leerProveedoresDeProducto(supabaseClient, productoId)
      if (peticion === ultimaPeticion.current) setVinculos(leidos)
    } catch (e) {
      console.error('No pudimos cargar los proveedores del producto.', e)
      if (peticion === ultimaPeticion.current) setHayError(true)
    } finally {
      if (peticion === ultimaPeticion.current) setCargando(false)
    }
  }, [productoId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const tras = async (mensaje: string) => {
    setAviso(mensaje)
    await cargar()
    onCambiado?.()
  }

  const marcar = async (vinculo: ProveedorDeProducto) => {
    if (enVuelo.current) return
    enVuelo.current = true
    setTrabajando(true)
    setError(null)
    setAviso(null)
    try {
      await marcarProveedorPrincipal(supabaseClient, productoId, vinculo.proveedorId)
      await tras(`${vinculo.razonSocial} es ahora el proveedor principal`)
    } catch (e) {
      setError(mensajeErrorProveedoresProducto(e, 'No pudimos cambiar el proveedor principal. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setTrabajando(false)
    }
  }

  const quitar = async () => {
    if (!quitando || enVuelo.current) return
    enVuelo.current = true
    setTrabajando(true)
    setError(null)
    setAviso(null)
    const vinculo = quitando
    try {
      await quitarProveedorProducto(supabaseClient, productoId, vinculo.proveedorId)
      setQuitando(null)
      await tras(`${vinculo.razonSocial} ya no es proveedor del producto`)
    } catch (e) {
      setQuitando(null)
      setError(mensajeErrorProveedoresProducto(e, 'No pudimos quitar el proveedor. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setTrabajando(false)
    }
  }

  const columnas: ColumnaAdaptable<ProveedorDeProducto>[] = [
    {
      clave: 'proveedor',
      encabezado: 'Proveedor',
      render: (v) => (
        <>
          {v.razonSocial}
          {v.principal ? <> <EtiquetaEstado texto="Principal" variante="exito" /></> : null}
          {v.activo ? null : <> <EtiquetaEstado texto="Inactivo" variante="aviso" /></>}
        </>
      ),
    },
    { clave: 'codigo', encabezado: 'Código del proveedor', render: (v) => v.codigoProveedor ?? '—' },
    ...(veCosto
      ? [{
          clave: 'costo',
          encabezado: 'Costo',
          align: 'right' as const,
          render: (v: ProveedorDeProducto) => (v.costo === null ? '—' : `${moneda} ${formatearNumeroImporte(v.costo, { centavos: 'siempre' })}`),
        }]
      : []),
    ...(puedeEditar
      ? [{
          clave: 'acciones',
          encabezado: 'Acciones',
          render: (v: ProveedorDeProducto) => (
            <>
              <Button size="small" disabled={trabajando} onClick={() => { setAviso(null); setError(null); setEdicion({ vinculo: v }) }} aria-label={`Editar ${v.razonSocial}`}>
                Editar
              </Button>
              {v.principal ? null : (
                <Button size="small" disabled={trabajando || !v.activo} onClick={() => void marcar(v)} aria-label={`Marcar a ${v.razonSocial} como principal`}>
                  Marcar como principal
                </Button>
              )}
              <Button size="small" color="warning" disabled={trabajando} onClick={() => setQuitando(v)} aria-label={`Quitar a ${v.razonSocial}`}>
                Quitar
              </Button>
            </>
          ),
        }]
      : []),
  ]

  return (
    <Box component="section" aria-labelledby="titulo-proveedores-producto" aria-busy={cargando}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography id="titulo-proveedores-producto" component="h2" variant="h6">Proveedores del producto</Typography>
        {puedeEditar ? (
          <Button variant="outlined" size="small" disabled={cargando || hayError} onClick={() => { setAviso(null); setError(null); setEdicion({ vinculo: null }) }}>
            Agregar proveedor
          </Button>
        ) : null}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        El proveedor principal es el del campo «Proveedor» del formulario; su costo es el costo del producto. Los cambios de esta sección se guardan al instante y recargan la ficha: guardá antes lo que estés editando arriba.
      </Typography>
      {aviso ? <EstadoExito titulo={aviso} /> : null}
      {error ? <EstadoError titulo="No se completó la acción." descripcion={error} /> : null}
      {cargando && vinculos.length === 0 ? (
        <EstadoCargaPagina />
      ) : hayError ? (
        <EstadoError descripcion="No pudimos cargar los proveedores del producto." reintentar={() => void cargar()} />
      ) : vinculos.length === 0 ? (
        <EstadoVacio titulo="Este producto todavía no tiene proveedores." />
      ) : (
        <ContenidoAdaptable items={vinculos} columnas={columnas} obtenerClave={(v) => v.proveedorId} etiquetaTabla="Proveedores del producto" />
      )}
      {edicion ? (
        <DialogoVinculo
          productoId={productoId}
          moneda={moneda}
          vinculo={edicion.vinculo}
          existentes={vinculos.map((v) => v.proveedorId)}
          editaCosto={editaCosto}
          onCerrar={() => setEdicion(null)}
          onGuardado={async (mensaje) => {
            setEdicion(null)
            await tras(mensaje)
          }}
        />
      ) : null}
      <Dialog open={quitando !== null} onClose={() => !trabajando && setQuitando(null)} aria-labelledby="titulo-quitar-proveedor-producto">
        <TituloDialogo id="titulo-quitar-proveedor-producto" onCerrar={() => !trabajando && setQuitando(null)}>Quitar proveedor</TituloDialogo>
        <DialogContent>
          <DialogContentText>
            {quitando?.principal
              ? `${quitando.razonSocial} es el proveedor principal: el producto quedará sin proveedor principal (no se elige otro solo).`
              : `El producto deja de figurar entre los productos de ${quitando?.razonSocial ?? ''}.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQuitando(null)} disabled={trabajando}>Cancelar</Button>
          <Button onClick={() => void quitar()} variant="contained" color="warning" disabled={trabajando} autoFocus>
            {trabajando ? 'Quitando…' : 'Quitar proveedor'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

type PropsDialogo = {
  productoId: string
  moneda: string
  // null = agregar un proveedor nuevo.
  vinculo: ProveedorDeProducto | null
  existentes: readonly string[]
  editaCosto: boolean
  onCerrar: () => void
  onGuardado: (mensaje: string) => Promise<void>
}

function DialogoVinculo({ productoId, moneda, vinculo, existentes, editaCosto, onCerrar, onGuardado }: PropsDialogo) {
  const { proveedores, cargando: cargandoProveedores, hayError: errorProveedores, recargar } = useProveedoresBasico()
  const [elegido, setElegido] = useState<string | null>(vinculo?.proveedorId ?? null)
  const [formulario, setFormulario] = useState<FormularioVinculo>(() => aFormularioVinculo(vinculo))
  const [errores, setErrores] = useState<ErroresVinculo>({})
  const [errorProveedor, setErrorProveedor] = useState<string | null>(null)
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const enVuelo = useRef(false)

  // Solo activos que todavía no están en el producto.
  const opciones = proveedores.filter((p) => p.activo && !existentes.includes(p.id))
  const proveedorElegido = proveedores.find((p) => p.id === elegido) ?? null

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault()
    if (enVuelo.current) return
    setErrorServidor(null)
    const nuevos = validarVinculo(formulario, editaCosto)
    setErrores(nuevos)
    setErrorProveedor(elegido === null ? 'Elegí un proveedor.' : null)
    if (elegido === null || Object.keys(nuevos).length > 0) return
    enVuelo.current = true
    setGuardando(true)
    try {
      await asignarProveedorProducto(supabaseClient, { productoId, proveedorId: elegido, formulario, conCosto: editaCosto })
      await onGuardado(vinculo ? 'Proveedor actualizado' : 'Proveedor agregado')
    } catch (e) {
      setErrorServidor(mensajeErrorProveedoresProducto(e, 'No pudimos guardar el proveedor. Intentá de nuevo.'))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  return (
    <Dialog open onClose={guardando ? undefined : onCerrar} fullWidth maxWidth="sm" aria-labelledby="titulo-proveedor-producto">
      <Box component="form" onSubmit={enviar} noValidate>
        <TituloDialogo id="titulo-proveedor-producto" onCerrar={guardando ? undefined : onCerrar}>
          {vinculo ? `Editar ${vinculo.razonSocial}` : 'Agregar proveedor'}
        </TituloDialogo>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {errorServidor ? <EstadoError titulo="No se guardó el proveedor." descripcion={errorServidor} /> : null}
            {vinculo ? null : (
              <>
                <Autocomplete
                  options={opciones}
                  value={proveedorElegido}
                  onChange={(_e, proveedor) => { setElegido(proveedor?.id ?? null); setErrorProveedor(null) }}
                  getOptionLabel={(p) => p.razon_social}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  loading={cargandoProveedores}
                  loadingText="Cargando proveedores…"
                  noOptionsText="No hay más proveedores activos"
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Proveedor"
                      required
                      autoFocus
                      error={Boolean(errorProveedor) || errorProveedores}
                      helperText={errorProveedores ? 'No pudimos cargar los proveedores.' : errorProveedor ?? 'Solo se ofrecen proveedores activos.'}
                    />
                  )}
                />
                {errorProveedores ? <Box><Button size="small" onClick={() => void recargar()}>Reintentar proveedores</Button></Box> : null}
              </>
            )}
            <TextField
              label="Código del proveedor" fullWidth autoComplete="off"
              value={formulario.codigo} onChange={(e) => setFormulario((a) => ({ ...a, codigo: e.target.value }))}
              error={Boolean(errores.codigo)} helperText={errores.codigo ?? `Opcional. Como lo identifica el proveedor (hasta ${LARGO_CODIGO_PROVEEDOR} caracteres).`}
            />
            {editaCosto ? (
              <TextField
                label={`Costo (${moneda})`} fullWidth autoComplete="off" inputMode="decimal"
                value={formulario.costo} onChange={(e) => setFormulario((a) => ({ ...a, costo: e.target.value }))}
                error={Boolean(errores.costo)} helperText={errores.costo ?? 'Opcional. Si es el proveedor principal, es el costo del producto.'}
              />
            ) : null}
            {vinculo?.principal ? null : (
              <FormControlLabel
                control={<Checkbox checked={formulario.principal} onChange={(e) => setFormulario((a) => ({ ...a, principal: e.target.checked }))} />}
                label="Proveedor principal"
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCerrar} disabled={guardando}>Cancelar</Button>
          <Button type="submit" variant="contained" disabled={guardando}>{guardando ? 'Guardando…' : vinculo ? 'Guardar cambios' : 'Agregar proveedor'}</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
