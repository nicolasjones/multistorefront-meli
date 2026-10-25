import { type ChangeEvent, type ComponentProps, type FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, MenuItem, Stack, TextField,
import { useCotizacionInicial } from '../../hooks/useCotizacionInicial'
import { type ProveedorBasico, useProveedoresBasico } from '../../hooks/useProveedoresBasico'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useCategorias } from '../../hooks/useCategorias'
import { useAlicuotas } from '../../hooks/useAlicuotas'
import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, FormControl, FormControlLabel,
  FormHelperText, FormLabel, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import {
  type CampoProducto,
  AYUDA_SKU,
  type ErroresProducto,
  type FormularioProducto as DatosFormulario,
  AVISO_FALTAN_DATOS,
  esConflicto,
  hayCambios,
  esSkuRepetido,
  mensajeDeError,
  parsearImporte,
  validarProducto,
} from '../../lib/productos'
import { type CambiosImagenes, type ImagenExistente, SIN_CAMBIOS_IMAGENES, hayCambiosImagenes } from '../../lib/productoImagenes'
import { EstadoError } from '../estados/EstadosPagina'
import { PrecioCostoBloque } from '../precios/PrecioCostoBloque'
import { EscalasPrecio } from '../precios/EscalasPrecio'
import {
  ESCALAS_CON_PRECIO,
  type ErroresEscala,
  type PreciosEscala,
  PRECIOS_ESCALA_VACIOS,
  hayCambiosEscalas,
  validarPreciosEscala,
} from '../../lib/escalas'
import { IvaProducto } from '../precios/IvaProducto'
import { SIN_ALICUOTA_PRODUCTO } from '../../lib/iva'
import { TituloDialogo } from '../base/TituloDialogo'
import { ImagenesProducto } from './ImagenesProducto'

type Props = {
  inicial: DatosFormulario
  // Imágenes ya guardadas del producto (edición); en el alta no hay.
  imagenesExistentes?: readonly ImagenExistente[]

  // Empresas que ya venden el producto (edición); en el alta no hay (F-CAT-07).
  empresasIniciales?: readonly string[]
  // Categoría actual del producto (edición, F-CAT-08); '' = sin categoría. En el alta no hay.
  categoriaInicial?: string
  // Alícuota propia del producto (edición, F-PRE-12); '' = hereda la de su categoría.
  alicuotaInicial?: string
  // Precios por escala del producto (edición, F-PRE-15); en el alta no hay (sin precio = usa la lista).
  escalasIniciales?: PreciosEscala
  // Disponibilidad vigente del producto (edición, F-CAT-17); la deriva la base. En el alta no hay.
  disponibilidadActual?: Disponibilidad | null
  // Costo visible y editable solo con edición en Rentabilidad (FR-003); la base lo exige igual.
  conCosto: boolean
  // El costo se ve con lectura en Rentabilidad pero solo se edita con edición (por defecto, igual a conCosto).
  costoEditable?: boolean
  etiquetaGuardar: string
  // Rechaza con el error del servidor; el formulario conserva lo escrito.
  onGuardar: (formulario: DatosFormulario, imagenes: CambiosImagenes) => Promise<void>
  onGuardar: (formulario: DatosFormulario, imagenes: CambiosImagenes, empresaIds: string[], categoriaId: string | null, alicuotaId: string | null, escalas: PreciosEscala) => Promise<void>
  rutaCancelar: string
  // Solo lectura (FR-011): ficha visible, sin acción de guardar.
  soloLectura?: boolean
  // Ante un conflicto de edición concurrente (40001) se ofrece recargar el producto.
  onRecargar?: () => void
}

const ETIQUETAS: Readonly<Record<CampoProducto, string>> = {
  nombre: 'Nombre',
  descripcion: 'Descripción',
  sku: 'SKU',
  compatible_con: 'Compatible con',
  moneda: 'Moneda',
  precio_lista: 'Precio de lista (sin IVA)',
  costo: 'Costo',
}

// Formulario compartido por el alta y (F-CAT-04) la edición de productos
// (FR-001, FR-003, FR-004). Sin stock inicial (FR-002).
const AYUDA_COSTO = 'Si lo dejás vacío se conserva el costo actual: todavía no se puede quitar un costo ya cargado.'

export function FormularioProducto({ inicial, imagenesExistentes = [], conCosto, costoEditable = conCosto, etiquetaGuardar, onGuardar, rutaCancelar, soloLectura = false, onRecargar }: Props) {
export function FormularioProducto({ inicial, imagenesExistentes = [], empresasIniciales = [], categoriaInicial = '', alicuotaInicial = SIN_ALICUOTA_PRODUCTO, escalasIniciales = PRECIOS_ESCALA_VACIOS, disponibilidadActual = null, conCosto, costoEditable = conCosto, etiquetaGuardar, onGuardar, rutaCancelar, soloLectura = false, onRecargar }: Props) {
  const navigate = useNavigate()
  const [formulario, setFormulario] = useState<DatosFormulario>(inicial)
  const [errores, setErrores] = useState<ErroresProducto>({})
  const [errorServidor, setErrorServidor] = useState<string | null>(null)
  const [errorSku, setErrorSku] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [conflicto, setConflicto] = useState(false)
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false)
  // El estado asíncrono llega tarde a un segundo clic inmediato: el ref lo frena.
  const enVuelo = useRef(false)
  const refs = useRef<Partial<Record<CampoProducto, HTMLInputElement | null>>>({})
  const [imagenes, setImagenes] = useState<CambiosImagenes>(SIN_CAMBIOS_IMAGENES)
  const sucio = hayCambios(formulario, inicial) || hayCambiosImagenes(imagenes)
  const { proveedores, cargando: cargandoProveedores, hayError: errorProveedores, recargar: recargarProveedores } = useProveedoresBasico()
  // Solo activos para asignaciones nuevas; el proveedor ya asignado se conserva aunque se haya desactivado (US3-3).
  const opcionesProveedor = proveedores.filter((p) => p.activo || p.id === inicial.proveedor_id)
  const proveedorElegido = proveedores.find((p) => p.id === formulario.proveedor_id) ?? null
  const cotizacion = useCotizacionInicial()
  const [empresaIds, setEmpresaIds] = useState<string[]>(() => [...empresasIniciales])
  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas, refetch: recargarEmpresas } = useEmpresas()
  const [categoriaId, setCategoriaId] = useState<string>(categoriaInicial)
  const { categorias, isLoading: cargandoCategorias, isError: errorCategorias, refetch: recargarCategorias } = useCategorias()
  const [alicuotaId, setAlicuotaId] = useState<string>(alicuotaInicial)
  const { alicuotas, porId: alicuotaPorId, isLoading: cargandoAlicuotas, isError: errorAlicuotas, refetch: recargarAlicuotas } = useAlicuotas()
  const alicuotaCategoria = alicuotaPorId.get(categorias.find((categoria) => categoria.id === categoriaId)?.alicuota_iva_id ?? '') ?? null
  const [escalas, setEscalas] = useState<PreciosEscala>(escalasIniciales)
  const [erroresEscalas, setErroresEscalas] = useState<ErroresEscala>({})
  const refsEscalas = useRef<Partial<Record<(typeof ESCALAS_CON_PRECIO)[number], HTMLInputElement | null>>>({})
  const netoEnPesos = formulario.moneda === 'ARS' ? parsearImporte(formulario.precio_lista) : null
  const sucio = hayCambios(formulario, inicial) || hayCambiosImagenes(imagenes) || empresasCambiaron(empresaIds, empresasIniciales) || categoriaId !== categoriaInicial || alicuotaId !== alicuotaInicial || hayCambiosEscalas(escalas, escalasIniciales)

  // «Sale» por cierre o recarga de la pestaña: el navegador pide confirmar.
  useEffect(() => {
    if (!sucio) {
      return undefined
    }
    const avisar = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [sucio])

  const cambiar = (campo: CampoProducto) => (event: ChangeEvent<HTMLInputElement>) => {
    setFormulario((actual) => ({ ...actual, [campo]: event.target.value }))
    if (campo === 'sku') {
      setErrorSku(null)
    }
    if (errores[campo]) {
      setErrores((actual) => ({ ...actual, [campo]: undefined }))
    }
  }

  const camposConError = (Object.keys(errores) as CampoProducto[]).filter((campo) => errores[campo])

  const enviar = async (event: FormEvent) => {
    event.preventDefault()
    if (enVuelo.current) {
      return
    }
    setErrorServidor(null)
    setErrorSku(null)
    setConflicto(false)
    const nuevos = validarProducto(formulario, { conCosto })
    setErrores(nuevos)
    const nuevosEscalas = validarPreciosEscala(escalas)
    setErroresEscalas(nuevosEscalas)
    const primero = (Object.keys(nuevos) as CampoProducto[])[0]
    if (primero) {
      refs.current[primero]?.focus()
      return
    }
    const primeraEscala = ESCALAS_CON_PRECIO.find((escala) => nuevosEscalas[escala])
    if (primeraEscala) {
      refsEscalas.current[primeraEscala]?.focus()
      return
    }
    enVuelo.current = true
    setGuardando(true)
    try {
      await onGuardar(formulario, imagenes)
      await onGuardar(formulario, imagenes, empresaIds, categoriaId === '' ? null : categoriaId, alicuotaId === SIN_ALICUOTA_PRODUCTO ? null : alicuotaId, escalas)
    } catch (error) {
      const mensaje = mensajeDeError(error, 'No pudimos guardar el producto.')
      if (esSkuRepetido(error)) {
        setErrorSku(mensaje)
        refs.current.sku?.focus()
      } else {
        setErrorServidor(mensaje)
      }
      setConflicto(esConflicto(error))
    } finally {
      enVuelo.current = false
      setGuardando(false)
    }
  }

  const cancelar = () => {
    if (sucio) {
      setConfirmandoDescarte(true)
    } else {
      navigate(rutaCancelar)
    }
  }

  const campoTexto = (campo: CampoProducto, extra: Partial<ComponentProps<typeof TextField>> = {}) => (
    <TextField
      label={ETIQUETAS[campo]}
      value={formulario[campo]}
      onChange={cambiar(campo)}
      error={Boolean(errores[campo])}
      helperText={errores[campo] ?? extra.helperText}
      inputRef={(elemento: HTMLInputElement | null) => {
        refs.current[campo] = elemento
      }}
      autoComplete="off"
      fullWidth
      disabled={soloLectura}
      {...extra}
    />
  )

  return (
    <Box component="form" onSubmit={enviar} noValidate sx={{ maxWidth: 560 }}>
      <Stack spacing={2}>
        {camposConError.length > 0 ? (
          <Alert severity="warning">
            <strong>{AVISO_FALTAN_DATOS}</strong>
            {': '}
            {camposConError.map((campo) => ETIQUETAS[campo]).join(', ')}
          </Alert>
        ) : null}
        {errorServidor ? (
          <EstadoError
            titulo="No se guardó el producto."
            descripcion={conflicto && onRecargar ? `${errorServidor} Al recargar se descarta lo que escribiste.` : errorServidor}
            reintentar={conflicto && onRecargar ? onRecargar : undefined}
            etiquetaReintentar="Recargar producto"
          />
        ) : null}
        {campoTexto('nombre', { required: true })}
        {campoTexto('descripcion', { multiline: true, minRows: 3 })}
        {campoTexto('sku', { helperText: errorSku ?? AYUDA_SKU, error: Boolean(errorSku) })}
        {campoTexto('compatible_con', { helperText: 'Separá los valores con comas, por ejemplo: PS5, Xbox' })}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select
            label={ETIQUETAS.moneda}
            value={formulario.moneda}
            onChange={(event) => setFormulario((actual) => ({ ...actual, moneda: event.target.value as DatosFormulario['moneda'] }))}
            disabled={soloLectura}
            fullWidth
          >
            {MONEDAS.map(({ valor, etiqueta }) => (
              <MenuItem key={valor} value={valor}>{etiqueta}</MenuItem>
            ))}
          </TextField>
          {campoTexto('precio_lista', { required: true, slotProps: { htmlInput: { inputMode: 'decimal' } } })}
        </Stack>
        <TextField
          label="Precio en pesos"
          value={PRECIO_EN_PESOS_NO_DISPONIBLE}
          disabled
          helperText="Se calcula cuando Precios esté disponible."
          fullWidth
        />
        {conCosto ? campoTexto('costo', { disabled: soloLectura || !costoEditable, helperText: costoEditable && !soloLectura ? AYUDA_COSTO : undefined, slotProps: { htmlInput: { inputMode: 'decimal' } } }) : null}
        <Autocomplete
          options={opcionesProveedor}
          value={proveedorElegido}
          onChange={(_evento, proveedor) => elegirProveedor(proveedor)}
          getOptionLabel={etiquetaProveedor}
          isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
          loading={cargandoProveedores}
          loadingText="Cargando proveedores…"
          noOptionsText="No hay proveedores activos"
          disabled={soloLectura}
          renderInput={(parametros) => (
            <TextField
              {...parametros}
              label={ETIQUETAS.proveedor_id}
              error={errorProveedores}
              helperText={errorProveedores ? 'No pudimos cargar los proveedores.' : 'Opcional. Solo se ofrecen proveedores activos.'}
            />
          )}
        />
        {errorProveedores ? (
          <Box><Button size="small" onClick={() => void recargarProveedores()}>Reintentar proveedores</Button></Box>
        ) : null}
        {campoTexto('codigo_proveedor', { disabled: soloLectura || formulario.proveedor_id === '', helperText: formulario.proveedor_id === '' ? 'Elegí un proveedor para cargar su código.' : 'Opcional. Como lo identifica el proveedor.' })}
        {campoTexto('codigo_barras', { helperText: errores.codigo_barras ?? errorCodigoBarras ?? 'Se puede escanear al armar un pedido o ingresar mercadería.', error: Boolean(errorCodigoBarras), slotProps: { htmlInput: { inputMode: 'numeric', placeholder: '13 dígitos, o escanealo' } } })}
        <PrecioCostoBloque
          moneda={formulario.moneda}
          precioLista={formulario.precio_lista}
          costo={formulario.costo}
          errorPrecio={errores.precio_lista}
          errorCosto={errores.costo}
          onMoneda={(moneda) => setFormulario((actual) => ({ ...actual, moneda }))}
          onPrecio={cambiar('precio_lista')}
          onCosto={cambiar('costo')}
          refPrecio={(elemento: HTMLInputElement | null) => {
            refs.current.precio_lista = elemento
          }}
          refCosto={(elemento: HTMLInputElement | null) => {
            refs.current.costo = elemento
          }}
          conCosto={conCosto}
          costoEditable={costoEditable}
          soloLectura={soloLectura}
          cotizacion={cotizacion.cotizacion}
          cargandoCotizacion={cotizacion.cargando}
          errorCotizacion={cotizacion.hayError}
          ayudaCosto={AYUDA_COSTO}
        />
        <EscalasPrecio
          moneda={formulario.moneda}
          precioLista={formulario.precio_lista}
          costo={formulario.costo}
          valores={escalas}
          errores={erroresEscalas}
          onCambiar={(escala, valor) => {
            setEscalas((actual) => ({ ...actual, [escala]: valor }))
            setErroresEscalas((actual) => ({ ...actual, [escala]: undefined }))
          }}
          refEscala={(escala) => (elemento: HTMLInputElement | null) => {
            refsEscalas.current[escala] = elemento
          }}
          conMargen={conCosto}
          cotizacion={cotizacion.cotizacion?.valor ?? null}
          soloLectura={soloLectura}
          deshabilitado={guardando}
        />
        <FormControl component="fieldset" disabled={soloLectura || guardando}>
          <FormLabel component="legend">{ETIQUETAS.disponibilidad_manual}</FormLabel>
          <RadioGroup
            value={formulario.disponibilidad_manual || disponibilidadActual || ''}
            onChange={(event) => setFormulario((actual) => ({ ...actual, disponibilidad_manual: event.target.value as DisponibilidadManual }))}
          >
            {DISPONIBILIDADES.map(({ valor, etiqueta, ayuda, manual }) => (
              <FormControlLabel
                key={valor}
                value={valor}
                // «Stock» y «Sin stock» las calcula la base según las existencias: se muestran, no se eligen.
                disabled={!manual || soloLectura || guardando}
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="b">{manual ? etiqueta : `${etiqueta} (calculado)`}</Typography>
                    <Typography variant="xs" display="block" color="text.secondary">{ayuda}</Typography>
                  </Box>
                }
              />
            ))}
          </RadioGroup>
          <FormHelperText>
            {formulario.disponibilidad_manual === ''
              ? 'Sin elección manual: se calcula según las existencias.'
              : 'Elegida a mano: manda sobre las existencias.'}
          </FormHelperText>
          {formulario.disponibilidad_manual !== '' && !soloLectura ? (
            <Box>
              <Button size="small" onClick={() => setFormulario((actual) => ({ ...actual, disponibilidad_manual: '' }))}>
                Quitar la elección manual
              </Button>
            </Box>
          ) : null}
        </FormControl>
        <SelectorCategoria
          categorias={categorias}
          valor={categoriaId}
          onCambiar={setCategoriaId}
          cargando={cargandoCategorias}
          hayError={errorCategorias}
          onReintentar={() => void recargarCategorias()}
          soloLectura={soloLectura}
          deshabilitado={guardando}
        />
        <IvaProducto
          alicuotas={alicuotas}
          alicuotaCategoria={alicuotaCategoria}
          valor={alicuotaId}
          onCambiar={setAlicuotaId}
          neto={netoEnPesos}
          cargando={cargandoAlicuotas}
          hayError={errorAlicuotas}
          onReintentar={() => void recargarAlicuotas()}
          soloLectura={soloLectura}
          deshabilitado={guardando}
        />
        <ImagenesProducto
          existentes={imagenesExistentes}
          cambios={imagenes}
          onCambiar={setImagenes}
          soloLectura={soloLectura}
          deshabilitado={guardando}
        />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={cancelar} disabled={guardando}>{soloLectura ? 'Volver' : 'Cancelar'}</Button>
          {soloLectura ? null : (
            <Button type="submit" variant="contained" disabled={guardando}>
              {guardando ? 'Guardando…' : etiquetaGuardar}
            </Button>
          )}
        </Stack>
      </Stack>

      <Dialog open={confirmandoDescarte} onClose={() => setConfirmandoDescarte(false)} aria-labelledby="descartar-titulo">
        <TituloDialogo id="descartar-titulo" onCerrar={() => setConfirmandoDescarte(false)}>Descartar cambios</TituloDialogo>
        <DialogContent>
          <DialogContentText>Tenés datos sin guardar. Si salís ahora, se pierden.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmandoDescarte(false)} autoFocus>Seguir editando</Button>
          <Button color="error" onClick={() => navigate(rutaCancelar)}>Descartar cambios</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
