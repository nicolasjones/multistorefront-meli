import { useEffect, useState } from 'react'
import { Alert, Box, Button, Stack } from '@mui/material'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { FORMULARIO_PRODUCTO_VACIO, type FormularioProducto as DatosFormulario, aParametrosCrear } from '../../lib/productos'
import { type CambiosImagenes, aplicarCambiosImagenes, leerImagenesProducto } from '../../lib/productoImagenes'
import { definirEmpresasProducto } from '../../lib/productoEmpresas'
import { asignarCategoriaProducto } from '../../lib/categorias'
import { asignarAlicuotaProducto, mensajeErrorIva } from '../../lib/iva'
import { type PreciosEscala, guardarPreciosEscala, hayPreciosEscala, mensajeErrorEscalas } from '../../lib/escalas'
import { guardarRelacionados, mensajeErrorRelacionados } from '../../lib/productos-relacionados'
import { type FilaVariante, guardarVariantes, mensajeErrorVariantes } from '../../lib/productos-variantes'
import { supabaseClient } from '../../lib/supabase'
import { AVISO_ORIGEN_NO_ENCONTRADO, PARAMETRO_DUPLICAR, type OrigenDuplicado, leerOrigenDuplicado } from '../../lib/duplicarProducto'
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
type Creado = { id: string; organizacionId: string; nombre: string; fallidas: File[]; errores: string[]; empresasPendientes: string[] | null; categoriaPendiente: string | null; alicuotaPendiente: string | null; escalasPendientes: PreciosEscala | null; relacionadosPendientes: string[] | null; variantesPendientes: FilaVariante[] | null }

type AltaProductoProps = {
  // Salir sin crear, o cerrar una vez creado: la página vuelve al listado y el popup se cierra.
  onCancelar: () => void
  // Avisa que se creó un producto (el listado se recarga).
  onCreado?: () => void
  etiquetaSalir?: string
  // F-CAT-13: id del producto a duplicar; precarga el formulario sin guardar nada.
  duplicarDe?: string | null
}

// Alta de producto sin marco de página: la usan la ruta `/productos/create` y el popup «Nuevo producto» del listado.
export function AltaProducto({ onCancelar, onCreado, etiquetaSalir = 'Ir a productos', duplicarDe = null }: AltaProductoProps) {
  const { nivel, isLoading } = useNivelSeccion('productos')
  const { nivel: nivelRentabilidad, isLoading: cargandoRentabilidad } = useNivelSeccion('rentabilidad')
  const { nivel: nivelStock } = useNivelSeccion('stock')
  const [creado, setCreado] = useState<Creado | null>(null)
  const [intento, setIntento] = useState(0)
  const [reintentando, setReintentando] = useState(false)
  const [errorEmpresas, setErrorEmpresas] = useState<string | null>(null)
  const [errorCategoria, setErrorCategoria] = useState<string | null>(null)
  const [errorAlicuota, setErrorAlicuota] = useState<string | null>(null)
  const [errorEscalas, setErrorEscalas] = useState<string | null>(null)
  const [errorRelacionados, setErrorRelacionados] = useState<string | null>(null)
  const [errorVariantes, setErrorVariantes] = useState<string | null>(null)
  // Duplicar (F-CAT-13): `undefined` = cargando el origen; `null` = alta vacía (sin duplicar, o origen inexistente/ajeno).
  const [origen, setOrigen] = useState<OrigenDuplicado | null | undefined>(duplicarDe ? undefined : null)
  const [avisoOrigen, setAvisoOrigen] = useState<string | null>(null)
  const permitido = !isLoading && !cargandoRentabilidad && nivel === 'edicion'
  const conCostoOrigen = nivelRentabilidad === 'edicion'

  useEffect(() => {
    if (!duplicarDe) {
      setOrigen(null)
      setAvisoOrigen(null)
      return
    }
    if (!permitido) return
    let vigente = true
    setOrigen(undefined)
    setAvisoOrigen(null)
    leerOrigenDuplicado(supabaseClient, duplicarDe, { conCosto: conCostoOrigen })
      .then((leido) => {
        if (!vigente) return
        setOrigen(leido)
        if (!leido) setAvisoOrigen(AVISO_ORIGEN_NO_ENCONTRADO)
      })
      .catch((error) => {
        console.error('No pudimos leer el producto a duplicar.', error)
        if (!vigente) return
        setOrigen(null)
        setAvisoOrigen(AVISO_ORIGEN_NO_ENCONTRADO)
      })
    return () => {
      vigente = false
    }
  }, [duplicarDe, permitido, conCostoOrigen])

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

  // El producto ya existe: si falla guardar las empresas no se revierte, se ofrece reintentar con lo elegido (FR-011).
  const guardarEmpresas = async (productoId: string, empresaIds: string[]) => {
    if (empresaIds.length === 0) return null
    try {
      await definirEmpresasProducto(supabaseClient, productoId, empresaIds)
      return null
    } catch (error) {
      console.error('No pudimos guardar las empresas del producto.', error)
      return empresaIds
    }
  }

  // Igual que las empresas: el producto ya existe, un fallo de la categoría no lo revierte (FR-022).
  const guardarCategoria = async (productoId: string, categoriaId: string | null) => {
    if (categoriaId === null) return null
    try {
      await asignarCategoriaProducto(supabaseClient, productoId, categoriaId)
      return null
    } catch (error) {
      console.error('No pudimos asignar la categoría del producto.', error)
      return categoriaId
    }
  }

  // Igual: el IVA propio se asigna después de crear; si falla, el producto hereda el de su categoría.
  const guardarAlicuota = async (productoId: string, alicuotaId: string | null) => {
    if (alicuotaId === null) return null
    try {
      await asignarAlicuotaProducto(supabaseClient, productoId, alicuotaId)
      return null
    } catch (error) {
      console.error('No pudimos asignar el IVA del producto.', error)
      return alicuotaId
    }
  }

  // Igual: los precios por escala se guardan después de crear; si fallan, el producto usa su precio de lista.
  const guardarEscalas = async (productoId: string, escalas: PreciosEscala) => {
    if (!hayPreciosEscala(escalas)) return null
    try {
      await guardarPreciosEscala(supabaseClient, productoId, escalas)
      return null
    } catch (error) {
      console.error('No pudimos guardar los precios por escala del producto.', error)
      return escalas
    }
  }

  // Igual: los relacionados se guardan después de crear (reemplazo idempotente); si fallan se ofrece reintentar.
  const guardarListaRelacionados = async (productoId: string, ids: string[]) => {
    if (ids.length === 0) return null
    try {
      await guardarRelacionados(supabaseClient, productoId, ids)
      return null
    } catch (error) {
      console.error('No pudimos guardar los productos relacionados.', error)
      return ids
    }
  }

  const guardar = async (formulario: DatosFormulario, imagenes: CambiosImagenes, empresaIds: string[], categoriaId: string | null, alicuotaId: string | null, escalas: PreciosEscala, relacionadosIds: string[], variantes: FilaVariante[]) => {
    const parametros = aParametrosCrear(formulario, { conCosto: nivelRentabilidad === 'edicion' })
    const { data, error } = await supabaseClient.rpc('crear_producto', parametros)
    if (error) {
      throw error
    }
    const fila = data as { id: string; organizacion_id: string; nombre: string; updated_at: string }
    // Variantes (F-CAT-15): primero, para que un fallo no deje al resto sin guardar. El producto ya existe: si
    // fallan se ofrece reintentar (la RPC no duplica las filas que ya se guardaron).
    let variantesPendientes: FilaVariante[] | null = null
    let mensajeVariantes: string | null = null
    if (variantes.length > 0) {
      try {
        await guardarVariantes(supabaseClient, fila.id, fila.updated_at, variantes, nivelStock === 'edicion')
      } catch (errorGuardado) {
        variantesPendientes = variantes
        mensajeVariantes = mensajeErrorVariantes(errorGuardado)
      }
    }
    // El producto ya existe: si alguna imagen falla no se revierte, se ofrece reintentar.
    const { fallidas, errores } = imagenes.nuevas.length > 0 ? await subirImagenes(fila, imagenes.nuevas) : { fallidas: [], errores: [] }
    const empresasPendientes = await guardarEmpresas(fila.id, empresaIds)
    const categoriaPendiente = await guardarCategoria(fila.id, categoriaId)
    const alicuotaPendiente = await guardarAlicuota(fila.id, alicuotaId)
    const escalasPendientes = await guardarEscalas(fila.id, escalas)
    const relacionadosPendientes = await guardarListaRelacionados(fila.id, relacionadosIds)
    setErrorEmpresas(null)
    setErrorCategoria(null)
    setErrorAlicuota(null)
    setErrorEscalas(null)
    setErrorRelacionados(null)
    setErrorVariantes(mensajeVariantes)
    setCreado({ id: fila.id, organizacionId: fila.organizacion_id, nombre: fila.nombre ?? parametros.p_nombre, fallidas, errores, empresasPendientes, categoriaPendiente, alicuotaPendiente, escalasPendientes, relacionadosPendientes, variantesPendientes })
    onCreado?.()
  }

  const reintentarEmpresas = async () => {
    if (!creado?.empresasPendientes) return
    setReintentando(true)
    setErrorEmpresas(null)
    try {
      await definirEmpresasProducto(supabaseClient, creado.id, creado.empresasPendientes)
      setCreado({ ...creado, empresasPendientes: null })
    } catch (error) {
      console.error('No pudimos reintentar guardar las empresas del producto.', error)
      setErrorEmpresas('No pudimos guardar las empresas. Probá de nuevo.')
    } finally {
      setReintentando(false)
    }
  }

  const reintentarCategoria = async () => {
    if (!creado?.categoriaPendiente) return
    setReintentando(true)
    setErrorCategoria(null)
    try {
      await asignarCategoriaProducto(supabaseClient, creado.id, creado.categoriaPendiente)
      setCreado({ ...creado, categoriaPendiente: null })
    } catch (error) {
      console.error('No pudimos reintentar asignar la categoría del producto.', error)
      setErrorCategoria('No pudimos asignar la categoría. Probá de nuevo.')
    } finally {
      setReintentando(false)
    }
  }

  const reintentarAlicuota = async () => {
    if (!creado?.alicuotaPendiente) return
    setReintentando(true)
    setErrorAlicuota(null)
    try {
      await asignarAlicuotaProducto(supabaseClient, creado.id, creado.alicuotaPendiente)
      setCreado({ ...creado, alicuotaPendiente: null })
    } catch (error) {
      console.error('No pudimos reintentar asignar el IVA del producto.', error)
      setErrorAlicuota(mensajeErrorIva(error, 'No pudimos asignar el IVA. Probá de nuevo.'))
    } finally {
      setReintentando(false)
    }
  }

  const reintentarEscalas = async () => {
    if (!creado?.escalasPendientes) return
    setReintentando(true)
    setErrorEscalas(null)
    try {
      await guardarPreciosEscala(supabaseClient, creado.id, creado.escalasPendientes)
      setCreado({ ...creado, escalasPendientes: null })
    } catch (error) {
      console.error('No pudimos reintentar guardar los precios por escala del producto.', error)
      setErrorEscalas(mensajeErrorEscalas(error))
    } finally {
      setReintentando(false)
    }
  }

  const reintentarVariantes = async () => {
    if (!creado?.variantesPendientes) return
    setReintentando(true)
    setErrorVariantes(null)
    try {
      await guardarVariantes(supabaseClient, creado.id, null, creado.variantesPendientes, nivelStock === 'edicion')
      setCreado({ ...creado, variantesPendientes: null })
    } catch (error) {
      setErrorVariantes(mensajeErrorVariantes(error))
    } finally {
      setReintentando(false)
    }
  }

  const reintentarRelacionados = async () => {
    if (!creado?.relacionadosPendientes) return
    setReintentando(true)
    setErrorRelacionados(null)
    try {
      await guardarRelacionados(supabaseClient, creado.id, creado.relacionadosPendientes)
      setCreado({ ...creado, relacionadosPendientes: null })
    } catch (error) {
      setErrorRelacionados(mensajeErrorRelacionados(error))
    } finally {
      setReintentando(false)
    }
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
    <>
        {isLoading || cargandoRentabilidad || nivel === null ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede crear productos." />
        ) : origen === undefined ? (
          <EstadoCargaPagina />
        ) : creado !== null ? (
          <Stack spacing={2}>
            <EstadoExito
              titulo="Producto creado"
              descripcion={`${creado.nombre} quedó activo en el catálogo.`}
              accion={
                <Stack direction="row" spacing={1}>
                  <Button
                    color="inherit"
                    onClick={() => {
                      setCreado(null)
                      setIntento((actual) => actual + 1)
                    }}
                  >
                    Cargar otro producto
                  </Button>
                  <Button color="inherit" onClick={onCancelar}>{etiquetaSalir}</Button>
                </Stack>
              }
            />
            {creado.empresasPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarEmpresas()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar empresas'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos guardar las empresas que lo venden.</strong>
                {errorEmpresas ? <Box component="span" sx={{ display: 'block' }}>{errorEmpresas}</Box> : null}
              </Alert>
            ) : null}
            {creado.categoriaPendiente ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarCategoria()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar categoría'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos asignarle la categoría.</strong>
                {errorCategoria ? <Box component="span" sx={{ display: 'block' }}>{errorCategoria}</Box> : null}
              </Alert>
            ) : null}
            {creado.alicuotaPendiente ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarAlicuota()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar IVA'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos asignarle el IVA: usa el de su categoría.</strong>
                {errorAlicuota ? <Box component="span" sx={{ display: 'block' }}>{errorAlicuota}</Box> : null}
              </Alert>
            ) : null}
            {creado.escalasPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarEscalas()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar precios por escala'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos guardar los precios por escala: usa el precio de lista.</strong>
                {errorEscalas ? <Box component="span" sx={{ display: 'block' }}>{errorEscalas}</Box> : null}
              </Alert>
            ) : null}
            {creado.variantesPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarVariantes()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar variantes'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos guardar las variantes.</strong>
                {errorVariantes ? <Box component="span" sx={{ display: 'block' }}>{errorVariantes}</Box> : null}
              </Alert>
            ) : null}
            {creado.relacionadosPendientes ? (
              <Alert
                severity="warning"
                action={
                  <Button color="inherit" size="small" onClick={() => void reintentarRelacionados()} disabled={reintentando}>
                    {reintentando ? 'Reintentando…' : 'Reintentar relacionados'}
                  </Button>
                }
              >
                <strong>El producto se creó, pero no pudimos guardar los productos relacionados.</strong>
                {errorRelacionados ? <Box component="span" sx={{ display: 'block' }}>{errorRelacionados}</Box> : null}
              </Alert>
            ) : null}
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
          <>
          {avisoOrigen ? <Alert severity="warning" sx={{ mb: 2 }}>{avisoOrigen}</Alert> : null}
          <FormularioProducto
            key={intento}
            inicial={origen?.formulario ?? FORMULARIO_PRODUCTO_VACIO}
            empresasIniciales={origen?.empresaIds}
            categoriaInicial={origen?.categoriaId}
            conCosto={nivelRentabilidad === 'edicion'}
            verStock={nivelStock === 'lectura' || nivelStock === 'edicion'}
            editarStock={nivelStock === 'edicion'}
            etiquetaGuardar="Crear producto"
            rutaCancelar="/productos"
            onCancelar={onCancelar}
            onGuardar={guardar}
          />
          </>
        )}
    </>
  )
}

export function ProductoCreate() {
  const navigate = useNavigate()
  const [parametros] = useSearchParams()
  return (
    <Box>
      <EncabezadoPagina titulo="Nuevo producto" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <AltaProducto onCancelar={() => navigate('/productos')} duplicarDe={parametros.get(PARAMETRO_DUPLICAR)} />
      </ContenedorSeccion>
    </Box>
  )
}
