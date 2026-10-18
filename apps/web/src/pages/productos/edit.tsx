import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { type FormularioProducto as DatosFormulario, type Producto, aFormulario, aParametrosActualizar } from '../../lib/productos'
import {
  type CambiosImagenes,
  type ImagenExistente,
  aplicarCambiosImagenes,
  firmarImagenes,
  hayCambiosImagenes,
} from '../../lib/productoImagenes'
import { supabaseClient } from '../../lib/supabase'
import { CambiarEstadoProducto } from '../../components/productos/CambiarEstadoProducto'
import { FormularioProducto } from '../../components/productos/FormularioProducto'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const COLUMNAS = 'id, organizacion_id, nombre, descripcion, sku, compatible_con, moneda, precio_lista, activo, updated_at, proveedor_id, codigo_proveedor'

type Carga = { producto: Producto | null; costo: number | string | null; imagenes: ImagenExistente[] }

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
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const [pendientes, setPendientes] = useState<{ fallidas: File[]; noEliminadas: string[]; errores: string[] } | null>(null)
  const [reintentando, setReintentando] = useState(false)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCarga(null)
    setHayError(false)
    setGuardado(null)
    setErrorEstado(null)
    setPendientes(null)
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
      let imagenes: ImagenExistente[] = []
      if (data) {
        const { data: filas, error: errorImagenes } = await supabaseClient
          .schema('dominio')
          .from('producto_imagenes')
          .select('id, posicion, ruta')
          .eq('producto_id', data.id)
          .order('posicion')
          .returns<Array<Omit<ImagenExistente, 'url'>>>()
        if (errorImagenes) throw errorImagenes
        imagenes = await firmarImagenes(supabaseClient, filas ?? [])
      }
      if (peticion === ultimaPeticion.current) setCarga({ producto: data, costo, imagenes })
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

  const aplicarImagenes = async (cambios: CambiosImagenes, existentes: readonly ImagenExistente[]) => {
    if (!producto || !hayCambiosImagenes(cambios)) return { fallidas: [], noEliminadas: [], errores: [] }
    try {
      return await aplicarCambiosImagenes(supabaseClient, {
        organizacionId: producto.organizacion_id,
        productoId: producto.id,
        existentes,
        cambios,
      })
    } catch (error) {
      // Los datos ya se guardaron: una excepción acá no debe verse como «no se guardó».
      console.error('No pudimos aplicar los cambios de imágenes.', error)
      return { fallidas: cambios.nuevas, noEliminadas: cambios.eliminadas, errores: ['No pudimos guardar los cambios de imágenes. Probá de nuevo.'] }
    }
  }

  const guardar = async (formulario: DatosFormulario, imagenes: CambiosImagenes) => {
    if (!producto) return
    // Si solo cambian imágenes no se llama a la RPC: evita subir `updated_at`, un evento
    // «producto actualizado» sin cambio real y un conflicto de bloqueo optimista falso.
    const inicial = aFormulario(producto, carga?.costo ?? null)
    const hayCambios = (Object.keys(inicial) as Array<keyof DatosFormulario>).some((campo) => inicial[campo] !== formulario[campo])
    if (hayCambios || !hayCambiosImagenes(imagenes)) {
      const parametros = aParametrosActualizar(formulario, { conCosto: editaCosto, id: producto.id, actualizadoEn: producto.updated_at })
      const { error } = await supabaseClient.rpc('actualizar_producto', parametros)
      if (error) {
        throw error
      }
    }
    // Los datos ya quedaron guardados: un fallo de imágenes no los revierte, se ofrece reintentar.
    const resultado = await aplicarImagenes(imagenes, carga?.imagenes ?? [])
    setPendientes(resultado.errores.length > 0 ? resultado : null)
    setGuardado(formulario.nombre.trim())
  }

  const reintentar = async () => {
    if (!pendientes) return
    setReintentando(true)
    try {
      // Tras los fallos parciales las posiciones cambiaron: se vuelven a leer antes de reintentar.
      const { data: filas, error } = await supabaseClient
        .schema('dominio')
        .from('producto_imagenes')
        .select('id, posicion, ruta')
        .eq('producto_id', producto?.id ?? '')
        .returns<Array<Omit<ImagenExistente, 'url'>>>()
      if (error) throw error
      const existentes = (filas ?? []).map((fila) => ({ ...fila, url: null }))
      setPendientes(await aplicarImagenes({ nuevas: pendientes.fallidas, eliminadas: pendientes.noEliminadas }, existentes))
    } catch (error) {
      console.error('No pudimos reintentar la subida de imágenes.', error)
      setPendientes({ ...pendientes, errores: [...pendientes.errores, 'No pudimos reintentar la subida. Probá de nuevo.'] })
    } finally {
      setReintentando(false)
    }
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
          <Stack spacing={2}>
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
            {pendientes ? (
              <Alert
                severity="warning"
                action={
                  pendientes.fallidas.length + pendientes.noEliminadas.length > 0 ? (
                    <Button color="inherit" size="small" onClick={() => void reintentar()} disabled={reintentando}>
                      {reintentando ? 'Reintentando…' : 'Reintentar'}
                    </Button>
                  ) : undefined
                }
              >
                <strong>Los datos se guardaron, pero hubo problemas con las imágenes:</strong>
                <Stack component="ul" sx={{ m: 0, pl: 2 }}>
                  {pendientes.errores.map((mensaje) => <li key={mensaje}>{mensaje}</li>)}
                </Stack>
              </Alert>
            ) : null}
          </Stack>
        ) : !producto ? (
          <EstadoError titulo="Producto no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Chip size="small" color={producto.activo ? 'success' : 'default'} label={producto.activo ? 'Activo' : 'Inactivo'} />
              {nivel === 'edicion' ? (
                <CambiarEstadoProducto
                  id={producto.id}
                  nombre={producto.nombre}
                  activo={producto.activo}
                  onCambiado={() => void cargar()}
                  onError={setErrorEstado}
                />
              ) : null}
              {nivel === 'edicion' ? (
                <Typography variant="caption" color="text.secondary">
                  Guardá tus cambios antes de cambiar el estado: al cambiarlo se recarga la ficha.
                </Typography>
              ) : null}
            </Stack>
            {errorEstado ? <Alert severity="error">{errorEstado}</Alert> : null}
          <FormularioProducto
            key={`${producto.id}:${producto.updated_at}`}
            inicial={aFormulario(producto, carga?.costo ?? null)}
            imagenesExistentes={carga?.imagenes ?? []}
            conCosto={veCosto}
            costoEditable={editaCosto}
            soloLectura={nivel !== 'edicion'}
            etiquetaGuardar="Guardar cambios"
            rutaCancelar="/productos"
            onGuardar={guardar}
            onRecargar={() => void cargar()}
          />
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
