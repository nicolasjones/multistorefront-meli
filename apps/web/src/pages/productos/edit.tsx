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

import { definirEmpresasProducto, empresasCambiaron, leerEmpresasProducto } from '../../lib/productoEmpresas'
import { asignarCategoriaProducto } from '../../lib/categorias'
import { SIN_ALICUOTA_PRODUCTO, asignarAlicuotaProducto, mensajeErrorIva } from '../../lib/iva'
import {
  PRECIOS_ESCALA_VACIOS,
  type PreciosEscala,
  guardarPreciosEscala,
  hayCambiosEscalas,
  leerPreciosEscala,
  mensajeErrorEscalas,
} from '../../lib/escalas'
import { supabaseClient } from '../../lib/supabase'
import { CambiarEstadoProducto } from '../../components/productos/CambiarEstadoProducto'
import { FormularioProducto } from '../../components/productos/FormularioProducto'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const COLUMNAS = 'id, organizacion_id, nombre, descripcion, sku, compatible_con, moneda, precio_lista, activo, updated_at'

type Carga = { producto: Producto | null; costo: number | string | null; imagenes: ImagenExistente[] }
const COLUMNAS = 'id, organizacion_id, nombre, descripcion, sku, compatible_con, moneda, precio_lista, activo, updated_at, proveedor_id, codigo_proveedor, codigo_barras, categoria_id, alicuota_iva_id, disponibilidad_manual'

type Carga = { producto: Producto | null; costo: number | string | null; imagenes: ImagenExistente[]; empresaIds: string[]; categoriaId: string; alicuotaId: string; escalas: PreciosEscala; disponibilidad: Disponibilidad | null }

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

  // Empresas elegidas que no se pudieron guardar (los datos del producto sí quedaron guardados).
  const [empresasPendientes, setEmpresasPendientes] = useState<string[] | null>(null)
  const [errorEmpresas, setErrorEmpresas] = useState<string | null>(null)
  // Categoría elegida que no se pudo guardar (los datos del producto sí quedaron guardados).
  const [categoriaPendiente, setCategoriaPendiente] = useState<string | null | undefined>(undefined)
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null)
  // IVA propio elegido que no se pudo guardar (null en el valor = volver a heredar de la categoría).
  const [alicuotaPendiente, setAlicuotaPendiente] = useState<{ id: string | null } | null>(null)
  const [errorAlicuota, setErrorAlicuota] = useState<string | null>(null)
  // Precios por escala elegidos que no se pudieron guardar (los datos del producto sí quedaron guardados).
  const [escalasPendientes, setEscalasPendientes] = useState<PreciosEscala | null>(null)
  const [errorEscalas, setErrorEscalas] = useState<string | null>(null)
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setCarga(null)
    setHayError(false)
    setGuardado(null)
    setErrorEstado(null)
    setPendientes(null)

    setEmpresasPendientes(null)
    setErrorEmpresas(null)
    setCategoriaPendiente(undefined)
    setErrorCategoria(null)
    setAlicuotaPendiente(null)
    setErrorAlicuota(null)
    setEscalasPendientes(null)
    setErrorEscalas(null)
    try {
      const { data, error } = await supabaseClient
        .schema('dominio')
        .from('productos')
        .select(COLUMNAS)
        .eq('id', id ?? '')
        .maybeSingle<Producto>()
        .maybeSingle<Producto & { categoria_id: string | null; alicuota_iva_id: string | null }>()
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

      const empresaIds = data ? await leerEmpresasProducto(supabaseClient, data.id) : []
      const escalas = data ? await leerPreciosEscala(supabaseClient, data.id) : PRECIOS_ESCALA_VACIOS
      // Disponibilidad vigente (F-CAT-17): la deriva la base; si no se puede leer, el formulario solo
      // omite el estado calculado (la elección manual sí se ve).
      let disponibilidad: Disponibilidad | null = null
      if (data) {
        try {
          const { data: fila, error: errorDisponibilidad } = await supabaseClient
            .from('v_productos_listado')
            .select('disponibilidad')
            .eq('id', data.id)
            .maybeSingle<{ disponibilidad: Disponibilidad }>()
          if (errorDisponibilidad) throw errorDisponibilidad
          disponibilidad = fila?.disponibilidad ?? null
        } catch (errorDisponibilidad) {
          console.error('No pudimos leer la disponibilidad del producto.', errorDisponibilidad)
        }
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
      if (peticion === ultimaPeticion.current) setCarga({ producto: data, costo, imagenes, empresaIds, categoriaId: data?.categoria_id ?? '', alicuotaId: data?.alicuota_iva_id ?? SIN_ALICUOTA_PRODUCTO, escalas, disponibilidad })
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
  const guardar = async (formulario: DatosFormulario, imagenes: CambiosImagenes, empresaIds: string[], categoriaId: string | null, alicuotaId: string | null, escalas: PreciosEscala) => {
    if (!producto) return
    // Si solo cambian imágenes no se llama a la RPC: evita subir `updated_at`, un evento
    // «producto actualizado» sin cambio real y un conflicto de bloqueo optimista falso.
    const inicial = aFormulario(producto, carga?.costo ?? null)
    const hayCambios = (Object.keys(inicial) as Array<keyof DatosFormulario>).some((campo) => inicial[campo] !== formulario[campo])
    if (hayCambios || !hayCambiosImagenes(imagenes)) {
    const cambioEmpresas = empresasCambiaron(empresaIds, carga?.empresaIds ?? [])
    const cambioCategoria = (categoriaId ?? '') !== (carga?.categoriaId ?? '')
    const cambioAlicuota = (alicuotaId ?? SIN_ALICUOTA_PRODUCTO) !== (carga?.alicuotaId ?? SIN_ALICUOTA_PRODUCTO)
    const cambioEscalas = hayCambiosEscalas(escalas, carga?.escalas ?? PRECIOS_ESCALA_VACIOS)
    if (hayCambios || !(hayCambiosImagenes(imagenes) || cambioEmpresas || cambioCategoria || cambioAlicuota || cambioEscalas)) {
      const parametros = aParametrosActualizar(formulario, { conCosto: editaCosto, id: producto.id, actualizadoEn: producto.updated_at })
      const { error } = await supabaseClient.rpc('actualizar_producto', parametros)
      if (error) {
        throw error
      }
    }
    // Los datos ya quedaron guardados: un fallo de imágenes no los revierte, se ofrece reintentar.
    // Los datos ya quedaron guardados: un fallo de empresas o de imágenes no los revierte, se ofrece reintentar.
    let sinGuardar: string[] | null = null
    if (cambioEmpresas) {
      try {
        await definirEmpresasProducto(supabaseClient, producto.id, empresaIds)
      } catch (error) {
        console.error('No pudimos guardar las empresas del producto.', error)
        sinGuardar = empresaIds
      }
    }
    setEmpresasPendientes(sinGuardar)
    setErrorEmpresas(null)
    let categoriaSinGuardar: string | null = null
    if (cambioCategoria) {
      try {
        await asignarCategoriaProducto(supabaseClient, producto.id, categoriaId)
      } catch (error) {
        console.error('No pudimos asignar la categoría del producto.', error)
        categoriaSinGuardar = categoriaId ?? ''
      }
    }
    setCategoriaPendiente(categoriaSinGuardar)
    setErrorCategoria(null)
    let alicuotaSinGuardar: { id: string | null } | null = null
    if (cambioAlicuota) {
      try {
        await asignarAlicuotaProducto(supabaseClient, producto.id, alicuotaId)
      } catch (error) {
        console.error('No pudimos asignar el IVA del producto.', error)
        alicuotaSinGuardar = { id: alicuotaId }
      }
    }
    setAlicuotaPendiente(alicuotaSinGuardar)
    setErrorAlicuota(null)
    let escalasSinGuardar: PreciosEscala | null = null
    if (cambioEscalas) {
      try {
        await guardarPreciosEscala(supabaseClient, producto.id, escalas)
      } catch (error) {
        console.error('No pudimos guardar los precios por escala del producto.', error)
        escalasSinGuardar = escalas
      }
    }
    setEscalasPendientes(escalasSinGuardar)
    setErrorEscalas(null)
    const resultado = await aplicarImagenes(imagenes, carga?.imagenes ?? [])
    setPendientes(resultado.errores.length > 0 ? resultado : null)
    setGuardado(formulario.nombre.trim())
  }


  const reintentarEmpresas = async () => {
    if (!producto || !empresasPendientes) return
    setReintentando(true)
    setErrorEmpresas(null)
    try {
      await definirEmpresasProducto(supabaseClient, producto.id, empresasPendientes)
      setEmpresasPendientes(null)
    } catch (error) {
      console.error('No pudimos reintentar guardar las empresas del producto.', error)
      setErrorEmpresas('No pudimos guardar las empresas. Probá de nuevo.')
    } finally {
      setReintentando(false)
    }
  }

  const reintentarCategoria = async () => {
    if (!producto || categoriaPendiente === null || categoriaPendiente === undefined) return
    setReintentando(true)
    setErrorCategoria(null)
    try {
      await asignarCategoriaProducto(supabaseClient, producto.id, categoriaPendiente === '' ? null : categoriaPendiente)
      setCategoriaPendiente(null)
    } catch (error) {
      console.error('No pudimos reintentar asignar la categoría del producto.', error)
      setErrorCategoria('No pudimos asignar la categoría. Probá de nuevo.')
    } finally {
      setReintentando(false)
    }
  }

  const reintentarAlicuota = async () => {
    if (!producto || !alicuotaPendiente) return
    setReintentando(true)
    setErrorAlicuota(null)
    try {
      await asignarAlicuotaProducto(supabaseClient, producto.id, alicuotaPendiente.id)
      setAlicuotaPendiente(null)
    } catch (error) {
      console.error('No pudimos reintentar asignar el IVA del producto.', error)
      setErrorAlicuota(mensajeErrorIva(error, 'No pudimos asignar el IVA. Probá de nuevo.'))
    } finally {
      setReintentando(false)
    }
  }

  const reintentarEscalas = async () => {
    if (!producto || !escalasPendientes) return
    setReintentando(true)
    setErrorEscalas(null)
    try {
      await guardarPreciosEscala(supabaseClient, producto.id, escalasPendientes)
      setEscalasPendientes(null)
    } catch (error) {
      console.error('No pudimos reintentar guardar los precios por escala del producto.', error)
      setErrorEscalas(mensajeErrorEscalas(error))
    } finally {
      setReintentando(false)
    }
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

            {empresasPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarEmpresas()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar empresas'}
                  </Button>
                }
              >
                <strong>Los datos se guardaron, pero no pudimos guardar las empresas que lo venden.</strong>
                {errorEmpresas ? <Box component="span" sx={{ display: 'block' }}>{errorEmpresas}</Box> : null}
              </Alert>
            ) : null}
            {categoriaPendiente !== null && categoriaPendiente !== undefined ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarCategoria()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar categoría'}
                  </Button>
                }
              >
                <strong>Los datos se guardaron, pero no pudimos guardar la categoría.</strong>
                {errorCategoria ? <Box component="span" sx={{ display: 'block' }}>{errorCategoria}</Box> : null}
              </Alert>
            ) : null}
            {alicuotaPendiente ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarAlicuota()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar IVA'}
                  </Button>
                }
              >
                <strong>Los datos se guardaron, pero no pudimos guardar el IVA.</strong>
                {errorAlicuota ? <Box component="span" sx={{ display: 'block' }}>{errorAlicuota}</Box> : null}
              </Alert>
            ) : null}
            {escalasPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarEscalas()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar precios por escala'}
                  </Button>
                }
              >
                <strong>Los datos se guardaron, pero no pudimos guardar los precios por escala.</strong>
                {errorEscalas ? <Box component="span" sx={{ display: 'block' }}>{errorEscalas}</Box> : null}
              </Alert>
            ) : null}
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

            empresasIniciales={carga?.empresaIds ?? []}
            categoriaInicial={carga?.categoriaId ?? ''}
            alicuotaInicial={carga?.alicuotaId ?? SIN_ALICUOTA_PRODUCTO}
            escalasIniciales={carga?.escalas ?? PRECIOS_ESCALA_VACIOS}
            disponibilidadActual={carga?.disponibilidad ?? null}
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
