import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Box, Button } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { type FormularioProducto as DatosFormulario, type Producto, aFormulario, aParametrosActualizar } from '../../lib/productos'
import { supabaseClient } from '../../lib/supabase'
import { FormularioProducto } from '../../components/productos/FormularioProducto'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const COLUMNAS = 'id, nombre, descripcion, sku, compatible_con, moneda, precio_lista, updated_at'

type Carga = { producto: Producto | null; costo: number | string | null }

// Edición de producto (F-CAT-04, FR-009/FR-011). La autoridad es RLS dentro de
// public.actualizar_producto (security invoker, bloqueo optimista por updated_at):
// acá solo se evita ofrecer guardar a quien no puede y el costo a quien no lo ve.
// Con lectura en Productos la ficha se muestra sin acción de guardar.
export function ProductoEdit() {
  const { id } = useParams()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('productos')
  const { nivel: nivelRentabilidad, isLoading: cargandoRentabilidad } = useNivelSeccion('rentabilidad')
  const veCosto = nivelRentabilidad === 'lectura' || nivelRentabilidad === 'edicion'
  const [carga, setCarga] = useState<Carga | null>(null)
  const [hayError, setHayError] = useState(false)
  const [guardado, setGuardado] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCarga(null)
    setHayError(false)
    try {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('productos')
        .select(COLUMNAS)
        .eq('id', id ?? '')
        .maybeSingle<Producto>()
      if (error) throw error
      let costo: number | string | null = null
      if (data && veCosto) {
        const { data: fila, error: errorCosto } = await supabaseClient
          .schema('dominio')
          .from('producto_costos')
          .select('costo')
          .eq('producto_id', data.id)
          .maybeSingle<{ costo: number | string }>()
        if (errorCosto) throw errorCosto
        costo = fila?.costo ?? null
      }
      if (peticion === ultimaPeticion.current) setCarga({ producto: data, costo })
    } catch (error) {
      console.error('No pudimos cargar el producto.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [id, veCosto])

  useEffect(() => {
    if (!verificandoPermiso && !cargandoRentabilidad && nivel !== null) {
      void cargar()
    }
  }, [cargar, verificandoPermiso, cargandoRentabilidad, nivel])

  const producto = carga?.producto ?? null
  const editaCosto = nivelRentabilidad === 'edicion'

  const guardar = async (formulario: DatosFormulario) => {
    if (!producto) return
    const parametros = aParametrosActualizar(formulario, { conCosto: editaCosto, id: producto.id, actualizadoEn: producto.updated_at })
    const { error } = await supabaseClient.rpc('actualizar_producto', parametros)
    if (error) {
      throw error
    }
    setGuardado(parametros.p_nombre)
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Editar producto" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {verificandoPermiso || cargandoRentabilidad || nivel === null || (!carga && !hayError) ? (
          <EstadoCargaPagina />
        ) : hayError ? (
          <EstadoError descripcion="No pudimos cargar el producto." reintentar={() => void cargar()} />
        ) : guardado !== null ? (
          <EstadoExito
            titulo="Producto guardado"
            descripcion={`Los cambios de ${guardado} quedaron guardados.`}
            accion={
              <Button
                color="inherit"
                onClick={() => {
                  setGuardado(null)
                  void cargar()
                }}
              >
                Seguir editando
              </Button>
            }
          />
        ) : !producto ? (
          <EstadoError titulo="Producto no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : (
          <FormularioProducto
            key={`${producto.id}:${producto.updated_at}`}
            inicial={aFormulario(producto, carga?.costo ?? null)}
            conCosto={veCosto}
            costoEditable={editaCosto}
            soloLectura={nivel !== 'edicion'}
            etiquetaGuardar="Guardar cambios"
            rutaCancelar="/productos"
            onGuardar={guardar}
            onRecargar={() => void cargar()}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
