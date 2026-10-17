import { useState } from 'react'
import { Box, Button } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { FORMULARIO_PRODUCTO_VACIO, type FormularioProducto as DatosFormulario, aParametrosCrear } from '../../lib/productos'
import { supabaseClient } from '../../lib/supabase'
import { FormularioProducto } from '../../components/productos/FormularioProducto'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

// Alta de producto (F-CAT-02, FR-001/FR-018). El permiso real lo aplica RLS dentro
// de public.crear_producto (security invoker): acá solo se evita ofrecer el
// formulario a quien no puede editar Productos y el costo a quien no edita
// Rentabilidad. La ficha del producto llega con F-CAT-04; hasta entonces el éxito
// se confirma en esta misma pantalla.
export function ProductoCreate() {
  const { nivel, isLoading } = useNivelSeccion('productos')
  const { nivel: nivelRentabilidad, isLoading: cargandoRentabilidad } = useNivelSeccion('rentabilidad')
  const [creado, setCreado] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  const guardar = async (formulario: DatosFormulario) => {
    const parametros = aParametrosCrear(formulario, { conCosto: nivelRentabilidad === 'edicion' })
    const { data, error } = await supabaseClient.rpc('crear_producto', parametros)
    if (error) {
      throw error
    }
    setCreado((data as { nombre: string } | null)?.nombre ?? parametros.p_nombre)
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Nuevo producto" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        {isLoading || cargandoRentabilidad || nivel === null ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede crear productos." />
        ) : creado !== null ? (
          <EstadoExito
            titulo="Producto creado"
            descripcion={`${creado} quedó activo en el catálogo.`}
            accion={
              <Button
                color="inherit"
                onClick={() => {
                  setCreado(null)
                  setIntento((actual) => actual + 1)
                }}
              >
                Cargar otro producto
              </Button>
            }
          />
        ) : (
          <FormularioProducto
            key={intento}
            inicial={FORMULARIO_PRODUCTO_VACIO}
            conCosto={nivelRentabilidad === 'edicion'}
            etiquetaGuardar="Crear producto"
            rutaCancelar="/"
            onGuardar={guardar}
          />
        )}
      </ContenedorSeccion>
    </Box>
  )
}
