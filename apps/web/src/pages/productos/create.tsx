import { useState } from 'react'
import { Alert, Box, Button, Stack } from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { FORMULARIO_PRODUCTO_VACIO, type FormularioProducto as DatosFormulario, aParametrosCrear } from '../../lib/productos'
import { type CambiosImagenes, aplicarCambiosImagenes, leerImagenesProducto } from '../../lib/productoImagenes'
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
type Creado = { id: string; organizacionId: string; nombre: string; fallidas: File[]; errores: string[] }

export function ProductoCreate() {
  const { nivel, isLoading } = useNivelSeccion('productos')
  const { nivel: nivelRentabilidad, isLoading: cargandoRentabilidad } = useNivelSeccion('rentabilidad')
  const [creado, setCreado] = useState<Creado | null>(null)
  const [intento, setIntento] = useState(0)
  const [reintentando, setReintentando] = useState(false)

  // `releer` en el reintento: las que ya subieron ocupan posiciones que hay que respetar.
  const subirImagenes = async (producto: { id: string; organizacion_id: string }, nuevas: File[], releer = false) => {
    try {
      const existentes = releer ? await leerImagenesProducto(supabaseClient, producto.id) : []
      return await aplicarCambiosImagenes(supabaseClient, {
        organizacionId: producto.organizacion_id,
        productoId: producto.id,
        existentes,
        cambios: { nuevas, eliminadas: [] },
      })
    } catch (error) {
      // El producto ya existe: una excepción acá no debe verse como «no se guardó».
      console.error('No pudimos subir las imágenes.', error)
      return { fallidas: nuevas, errores: ['No pudimos subir las imágenes. Probá de nuevo.'] }
    }
  }

  const guardar = async (formulario: DatosFormulario, imagenes: CambiosImagenes) => {
    const parametros = aParametrosCrear(formulario, { conCosto: nivelRentabilidad === 'edicion' })
    const { data, error } = await supabaseClient.rpc('crear_producto', parametros)
    if (error) {
      throw error
    }
    const fila = data as { id: string; organizacion_id: string; nombre: string }
    // El producto ya existe: si alguna imagen falla no se revierte, se ofrece reintentar.
    const { fallidas, errores } = imagenes.nuevas.length > 0 ? await subirImagenes(fila, imagenes.nuevas) : { fallidas: [], errores: [] }
    setCreado({ id: fila.id, organizacionId: fila.organizacion_id, nombre: fila.nombre ?? parametros.p_nombre, fallidas, errores })
  }

  const reintentar = async () => {
    if (!creado) return
    setReintentando(true)
    try {
      const { fallidas, errores } = await subirImagenes({ id: creado.id, organizacion_id: creado.organizacionId }, creado.fallidas, true)
      setCreado({ ...creado, fallidas, errores })
    } finally {
      setReintentando(false)
    }
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
          <Stack spacing={2}>
            <EstadoExito
              titulo="Producto creado"
              descripcion={`${creado.nombre} quedó activo en el catálogo.`}
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
            {creado.errores.length > 0 ? (
              <Alert
                severity="warning"
                action={
                  <Stack direction="row" spacing={1}>
                    {creado.fallidas.length > 0 ? (
                      <Button color="inherit" size="small" onClick={() => void reintentar()} disabled={reintentando}>
                        {reintentando ? 'Reintentando…' : 'Reintentar subida'}
                      </Button>
                    ) : null}
                    <Button color="inherit" size="small" component={RouterLink} to={`/productos/${creado.id}/edit`}>
                      Editar producto
                    </Button>
                  </Stack>
                }
              >
                <strong>El producto se creó, pero hubo problemas con las imágenes:</strong>
                <Stack component="ul" sx={{ m: 0, pl: 2 }}>
                  {creado.errores.map((mensaje) => <li key={mensaje}>{mensaje}</li>)}
                </Stack>
              </Alert>
            ) : null}
          </Stack>
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
