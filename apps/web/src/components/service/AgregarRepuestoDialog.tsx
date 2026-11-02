import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Autocomplete, FormHelperText, TextField } from '@mui/material'
import {
  LARGO_MAXIMO_DESCRIPCION_ITEM,
  buscarProductos,
  descuentaStock,
  listarDepositosParaRepuesto,
  parsearCantidad,
  type DepositoRepuesto,
  type ProductoRepuesto,
} from '../../lib/reparacionItems'
import { revisionEmpresaActiva, suscribirEmpresaActiva } from '../../lib/empresaActivaRevision'
import type { Reparacion } from '../../lib/reparaciones'
import { AgregarItemDialog, type CampoConceptoProps } from './AgregarItemDialog'
import { SelectorDepositoRepuesto } from './SelectorDepositoRepuesto'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  onCerrar: () => void
  onAgregada: (reparacion: Reparacion) => void
  // Aviso al cerrarse solo porque cambió la empresa activa (Principio VIII).
  onAviso?: (mensaje: string) => void
}

export const AVISO_CAMBIO_DE_EMPRESA = 'Cambiaste de tienda: cerramos «Agregar repuesto» para no mezclar datos de dos tiendas.'

const ESPERA_BUSQUEDA_MS = 300

function etiquetaProducto(producto: ProductoRepuesto): string {
  return producto.sku ? `${producto.nombre} (${producto.sku})` : producto.nombre
}

// Buscador de producto del catálogo por Nombre o SKU; lo que no está en el catálogo se escribe y queda como
// repuesto libre (FR-025). Al elegir un producto la descripción toma su nombre y el precio NO se precarga.
function BuscadorProducto({ formulario, cambiar, errores, deshabilitado }: CampoConceptoProps) {
  const [texto, setTexto] = useState('')
  const [opciones, setOpciones] = useState<ProductoRepuesto[]>([])
  const [errorBusqueda, setErrorBusqueda] = useState(false)

  useEffect(() => {
    const consulta = texto.trim()
    if (consulta === '' || formulario.producto) {
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
  }, [texto, formulario.producto])

  const error = errores.producto_id ?? errores.descripcion
  const ayuda = errorBusqueda
    ? 'No pudimos buscar en el catálogo. Podés escribir el repuesto y cargarlo libre.'
    : 'Nombre o SKU. Si no está en el catálogo, escribilo y se carga como repuesto libre.'

  return (
    <Autocomplete<ProductoRepuesto, false, false, true>
      freeSolo
      disabled={deshabilitado}
      options={opciones}
      filterOptions={(todas) => todas}
      getOptionLabel={(opcion) => (typeof opcion === 'string' ? opcion : etiquetaProducto(opcion))}
      isOptionEqualToValue={(opcion, valor) => opcion.id === valor.id}
      value={formulario.producto}
      inputValue={texto}
      noOptionsText="Sin productos para esa búsqueda"
      onInputChange={(_evento, valor, motivo) => {
        setTexto(valor)
        // Escribir deja de ser «el producto elegido»: pasa a ser un repuesto libre con esa descripción.
        if (motivo === 'input') cambiar({ descripcion: valor, producto: null })
        if (motivo === 'clear') cambiar({ descripcion: '', producto: null })
      }}
      onChange={(_evento, elegido) => {
        if (elegido && typeof elegido !== 'string') {
          setTexto(etiquetaProducto(elegido))
          cambiar({ producto: elegido, descripcion: elegido.nombre })
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Buscar producto del catálogo"
          required
          autoFocus
          error={Boolean(error)}
          helperText={error ?? ayuda}
          inputProps={{ ...params.inputProps, maxLength: LARGO_MAXIMO_DESCRIPCION_ITEM }}
        />
      )}
    />
  )
}

// Depósitos del producto elegido y cuánto hay en cada uno (F-SVC-10, FR-006). Un producto «a pedido», un repuesto libre
// o sin producto no descuentan stock: no hay depósito que elegir. Al cargar, preselecciona el depósito por defecto.
function DepositoDelRepuesto({ formulario, cambiar, errores, deshabilitado }: CampoConceptoProps) {
  const producto = formulario.producto
  const [depositos, setDepositos] = useState<DepositoRepuesto[]>([])
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cambiarRef = useRef(cambiar)
  cambiarRef.current = cambiar
  const productoId = producto?.id ?? null
  const mueveStock = descuentaStock(producto)

  useEffect(() => {
    setDepositos([])
    setError(null)
    if (!productoId || !mueveStock) {
      setCargando(false)
      cambiarRef.current({ deposito_id: null })
      return
    }
    let vigente = true
    setCargando(true)
    listarDepositosParaRepuesto(productoId)
      .then((encontrados) => {
        if (!vigente) return
        setDepositos(encontrados)
        const inicial = encontrados.find((deposito) => deposito.por_defecto) ?? encontrados[0] ?? null
        cambiarRef.current({ deposito_id: inicial?.deposito_id ?? null })
      })
      .catch((falla) => {
        if (!vigente) return
        console.error('No pudimos consultar los depósitos del repuesto.', falla)
        setError('No pudimos consultar los depósitos. Cerrá y volvé a abrir el diálogo.')
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [productoId, mueveStock])

  if (!producto) return null
  if (!mueveStock) {
    return <FormHelperText>Producto a pedido: no descuenta stock.</FormHelperText>
  }
  return (
    <SelectorDepositoRepuesto
      depositos={depositos}
      valor={formulario.deposito_id}
      cantidad={parsearCantidad(formulario.cantidad)}
      cargando={cargando}
      error={error ?? errores.deposito_id ?? null}
      deshabilitado={deshabilitado}
      onElegir={(depositoId) => cambiar({ deposito_id: depositoId })}
    />
  )
}

// «Agregar repuesto» (F-SVC-06, FR-025 y FR-028; F-SVC-10, FR-006 y FR-012): el repuesto del catálogo se descuenta
// del depósito elegido. Si cambia la empresa activa mientras está abierto, se cierra con aviso: no guarda datos
// cargados de una tienda bajo otra y al reabrirlo consulta la disponibilidad de nuevo.
export function AgregarRepuestoDialog({ onAviso, ...props }: Props) {
  const revision = useSyncExternalStore(suscribirEmpresaActiva, revisionEmpresaActiva, revisionEmpresaActiva)
  const revisionAlAbrir = useRef(revision)
  const { abierto, onCerrar } = props

  useEffect(() => {
    if (!abierto) revisionAlAbrir.current = revision
  }, [abierto, revision])

  useEffect(() => {
    if (abierto && revision !== revisionAlAbrir.current) {
      revisionAlAbrir.current = revision
      onCerrar()
      onAviso?.(AVISO_CAMBIO_DE_EMPRESA)
    }
  }, [abierto, revision, onCerrar, onAviso])

  return (
    <AgregarItemDialog
      {...props}
      tipo="repuesto"
      titulo="Agregar repuesto"
      renderConcepto={(campo) => <BuscadorProducto {...campo} />}
      renderExtra={(campo) => <DepositoDelRepuesto {...campo} />}
    />
  )
}
