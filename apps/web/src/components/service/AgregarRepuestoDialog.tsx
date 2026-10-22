import { useEffect, useState } from 'react'
import { Autocomplete, TextField } from '@mui/material'
import { LARGO_MAXIMO_DESCRIPCION_ITEM, buscarProductos, type ProductoRepuesto } from '../../lib/reparacionItems'
import type { Reparacion } from '../../lib/reparaciones'
import { AgregarItemDialog, type CampoConceptoProps } from './AgregarItemDialog'

type Props = {
  abierto: boolean
  reparacion: Reparacion
  onCerrar: () => void
  onAgregada: (reparacion: Reparacion) => void
}

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

// «Agregar repuesto» (F-SVC-06, FR-025 y FR-028). Sin depósito: el descuento de stock es otra funcionalidad.
export function AgregarRepuestoDialog(props: Props) {
  return (
    <AgregarItemDialog
      {...props}
      tipo="repuesto"
      titulo="Agregar repuesto"
      renderConcepto={(campo) => <BuscadorProducto {...campo} />}
    />
  )
}
