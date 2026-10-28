import { useEffect, useState } from 'react'
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { TituloDialogo } from '../base/TituloDialogo'
import { buscarProductos, type ProductoRepuesto } from '../../lib/reparacionItems'
import type { DepositoOpcion } from '../../lib/depositos'
import { disponibleParaVenta } from '../../lib/ventasLineas'

type Props = {
  disabled?: boolean
  /** Depósito por defecto de las líneas nuevas: sobre él se muestra el disponible antes de agregar. */
  depositoPorDefecto: DepositoOpcion | null
  onElegir: (producto: ProductoRepuesto) => void
}

const ESPERA_BUSQUEDA_MS = 300

const etiquetaProducto = (producto: ProductoRepuesto) => (producto.sku ? `${producto.nombre} (${producto.sku})` : producto.nombre)

// «Agregar producto» (F-VTA-06, FR-012): buscador del catálogo por Nombre o SKU. Al elegir un producto se muestra
// cuánto hay disponible en el depósito por defecto (FR-017) y «Agregar» lo incorpora como línea. El precio y la
// escala los calcula la base al guardar: el diálogo nunca los fija.
export function AgregarProductoDialog({ disabled = false, depositoPorDefecto, onElegir }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [entrada, setEntrada] = useState('')
  const [opciones, setOpciones] = useState<ProductoRepuesto[]>([])
  const [elegido, setElegido] = useState<ProductoRepuesto | null>(null)
  const [errorBusqueda, setErrorBusqueda] = useState(false)
  const [disponible, setDisponible] = useState<number | null | 'cargando' | 'error'>(null)

  const cerrar = () => {
    setAbierto(false)
    setEntrada('')
    setOpciones([])
    setElegido(null)
    setErrorBusqueda(false)
    setDisponible(null)
  }

  useEffect(() => {
    const consulta = entrada.trim()
    if (!abierto || consulta === '' || elegido) {
      setOpciones([])
      return
    }
    let vigente = true
    const temporizador = setTimeout(() => {
      buscarProductos(consulta)
        .then((encontrados) => {
          if (!vigente) return
          setErrorBusqueda(false)
          setOpciones(encontrados)
        })
        .catch((error) => {
          if (!vigente) return
          console.error('No pudimos buscar productos del catálogo.', error)
          setErrorBusqueda(true)
          setOpciones([])
        })
    }, ESPERA_BUSQUEDA_MS)
    return () => {
      vigente = false
      clearTimeout(temporizador)
    }
  }, [abierto, entrada, elegido])

  const productoId = elegido?.id ?? null
  const depositoId = depositoPorDefecto?.id ?? null
  useEffect(() => {
    if (!productoId || !depositoId) {
      setDisponible(null)
      return
    }
    let vigente = true
    setDisponible('cargando')
    disponibleParaVenta(productoId, depositoId)
      .then((cantidad) => {
        if (vigente) setDisponible(cantidad)
      })
      .catch((error) => {
        console.error('No pudimos consultar el stock disponible.', error)
        if (vigente) setDisponible('error')
      })
    return () => {
      vigente = false
    }
  }, [productoId, depositoId])

  const agregar = () => {
    if (!elegido) return
    onElegir(elegido)
    cerrar()
  }

  return (
    <>
      <Button variant="outlined" size="small" startIcon={<AddIcon />} disabled={disabled} onClick={() => setAbierto(true)}>
        Agregar producto
      </Button>
      <Dialog open={abierto} onClose={cerrar} fullWidth maxWidth="sm" aria-labelledby="agregar-producto-titulo">
        <TituloDialogo id="agregar-producto-titulo" onCerrar={cerrar}>
          Agregar producto
        </TituloDialogo>
        <DialogContent>
          <Autocomplete<ProductoRepuesto>
            options={opciones}
            filterOptions={(todas) => todas}
            getOptionLabel={etiquetaProducto}
            isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
            value={elegido}
            inputValue={entrada}
            noOptionsText={entrada.trim() === '' ? 'Escribí el nombre o el SKU' : 'Sin productos para esa búsqueda'}
            onInputChange={(_evento, valor, motivo) => {
              if (motivo === 'input') setEntrada(valor)
              if (motivo === 'clear') {
                setEntrada('')
                setElegido(null)
              }
            }}
            onChange={(_evento, nuevo) => {
              setElegido(nuevo)
              if (nuevo) setEntrada(etiquetaProducto(nuevo))
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                autoFocus
                label="Buscar producto del catálogo"
                error={errorBusqueda}
                helperText={errorBusqueda ? 'No pudimos buscar en el catálogo. Escribí de nuevo para reintentar.' : 'Nombre o SKU.'}
              />
            )}
          />
          {elegido && depositoPorDefecto ? (
            <Typography variant="body2" sx={{ mt: 2 }} aria-live="polite">
              {disponible === 'cargando'
                ? 'Consultando el stock…'
                : disponible === 'error'
                  ? 'No pudimos consultar el stock disponible. Podés agregar el producto igual.'
                  : disponible === null
                    ? null
                    : `Disponible en ${depositoPorDefecto.nombre}: ${disponible}. El depósito se puede cambiar en la línea.`}
            </Typography>
          ) : null}
          {elegido && !depositoPorDefecto ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              La organización todavía no tiene depósitos activos: el stock no se puede consultar.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={cerrar}>Cancelar</Button>
          <Button variant="contained" onClick={agregar} disabled={!elegido}>
            Agregar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
