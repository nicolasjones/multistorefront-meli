import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, Stack } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useOrganizacionActiva } from '../../hooks/useOrganizacionActiva'
import { useAlicuotas } from '../../hooks/useAlicuotas'
import { guardarAlicuotaCategoria, mensajeErrorIva } from '../../lib/iva'
import { supabaseClient } from '../../lib/supabase'
import {
  type Categoria,
  type NodoCategoria,
  type ResultadoMovimiento,
  armarArbol,
  eliminarCategoria,
  filtrarArbolPorTienda,
  guardarCategoria,
  leerCategorias,
  mensajeErrorCategoria,
  moverEnNivel,
  reordenarCategorias,
  soltarSobre,
} from '../../lib/categorias'
import { ArbolCategorias } from '../../components/categorias/ArbolCategorias'
import { EliminarCategoriaDialogo } from '../../components/categorias/EliminarCategoriaDialogo'
import { FormularioCategoria, type DatosCategoria } from '../../components/categorias/FormularioCategoria'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Edicion = { categoria: Categoria | null; padreInicial: string | null }

// Catálogo → Categorías (F-CAT-08, FR-018…FR-024): árbol de 2 niveles con «Expandir todo» / «Contraer todo»,
// filtro de tienda (sigue a la empresa activa de la barra superior, F-ROL-06), alta/edición, eliminación y
// reordenado por arrastre o por teclado. Con lectura el árbol se ve sin acciones; la autoridad es RLS
// (`private.nivel_seccion('categorias')`) y las RPC. Las categorías son de la organización: la empresa
// activa solo filtra qué se ve (no hay datos por empresa que reencuadrar).
export function CategoriaList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('categorias')
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const { empresas: empresasAccesibles, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId, hayError: errorEmpresas } = useFiltroPorEmpresaActiva()
  const { empresas } = useEmpresas()
  const { organizacionActiva } = useOrganizacionActiva()
  const { alicuotas, porId: alicuotaPorId } = useAlicuotas()
  const organizacionId = organizacionActiva?.id ?? null
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  const [conteos, setConteos] = useState<Map<string, number>>(new Map())
  const [hayError, setHayError] = useState(false)
  const [aviso, setAviso] = useState<{ severidad: 'error' | 'warning'; texto: string } | null>(null)
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const [edicion, setEdicion] = useState<Edicion | null>(null)
  const [eliminando, setEliminando] = useState<NodoCategoria | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const ultimaPeticion = useRef(0)
  const primeraCarga = useRef(true)

  // `empresaActivaId` y `organizacionId` van en las dependencias para rehacer la carga al cambiar de
  // empresa u organización en la barra superior (Principio VIII), aunque la consulta en sí no las use:
  // RLS resuelve la organización.
  const cargar = useCallback(async () => {
    void empresaActivaId
    void organizacionId
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const resultado = await leerCategorias(supabaseClient)
      if (peticion !== ultimaPeticion.current) return
      setCategorias(resultado.categorias)
      setConteos(resultado.conteos)
      if (primeraCarga.current) {
        primeraCarga.current = false
        setExpandidos(new Set(resultado.categorias.filter((c) => c.padre_id === null).map((c) => c.id)))
      }
    } catch (error) {
      console.error('No pudimos cargar las categorías.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [empresaActivaId, organizacionId])

  // Al cambiar de organización no se muestra nada de la anterior: se vacía el árbol, se reinicia la
  // expansión y se cierran los diálogos (jamás guardan datos de la organización anterior).
  useEffect(() => {
    ultimaPeticion.current++
    primeraCarga.current = true
    setCategorias(null)
    setConteos(new Map())
    setExpandidos(new Set())
    setEdicion(null)
    setEliminando(null)
  }, [organizacionId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const arbolCompleto = useMemo(() => armarArbol(categorias ?? [], conteos), [categorias, conteos])
  const arbol = useMemo(() => filtrarArbolPorTienda(arbolCompleto, empresaId), [arbolCompleto, empresaId])
  const conHijas = useMemo(() => arbol.filter((raiz) => raiz.hijos.length > 0).map((raiz) => raiz.id), [arbol])

  const alternar = (id: string) =>
    setExpandidos((actual) => {
      const siguiente = new Set(actual)
      if (!siguiente.delete(id)) siguiente.add(id)
      return siguiente
    })

  const guardar = async (datos: DatosCategoria) => {
    const id = await guardarCategoria(supabaseClient, datos)
    // Una subcategoría nueva queda a la vista bajo su raíz.
    if (datos.padreId) setExpandidos((actual) => new Set(actual).add(datos.padreId as string))
    setEdicion(null)
    setAviso(null)
    // La categoría ya está guardada: si falla solo el IVA no se reintenta desde el diálogo (duplicaría
    // el alta); se avisa y se edita desde la fila.
    if (datos.alicuotaId && datos.alicuotaId !== datos.alicuotaOriginalId) {
      try {
        await guardarAlicuotaCategoria(supabaseClient, id, datos.alicuotaId)
      } catch (error) {
        console.error('No se pudo guardar el IVA de la categoría', error)
        setAviso({ severidad: 'error', texto: `La categoría se guardó, pero no su IVA. ${mensajeErrorIva(error, 'Editala para elegir el IVA de nuevo.')}` })
      }
    }
    await cargar()
  }

  const confirmarEliminar = async () => {
    if (!eliminando) return
    await eliminarCategoria(supabaseClient, eliminando.id)
    setEliminando(null)
    setAviso(null)
    await cargar()
  }

  // Aplica un movimiento ya calculado: rechazo visible si viola los 2 niveles o repite un nombre.
  const aplicar = async (resultado: ResultadoMovimiento) => {
    if (!resultado.ok) {
      setAviso(resultado.motivo ? { severidad: 'warning', texto: resultado.motivo } : null)
      return
    }
    setAviso(null)
    setOcupado(true)
    try {
      await reordenarCategorias(supabaseClient, resultado.orden)
    } catch (error) {
      console.error('No pudimos reordenar las categorías.', error)
      setAviso({ severidad: 'error', texto: mensajeErrorCategoria(error, 'No pudimos guardar el nuevo orden. Probá de nuevo.') })
    } finally {
      setOcupado(false)
    }
    await cargar()
  }

  const todas = categorias ?? []
  const hayFiltro = empresaId !== null
  const visibles = useMemo(
    () => arbol.reduce((total, raiz) => total + 1 + raiz.hijos.length, 0),
    [arbol],
  )
  const nombreTienda = empresasAccesibles.find((empresa) => empresa.id === empresaId)?.nombre
  const contador = hayFiltro
    ? `${visibles} de ${todas.length} ${todas.length === 1 ? 'categoría' : 'categorías'}${nombreTienda ? ` · ${nombreTienda}` : ''}`
    : `${todas.length} ${todas.length === 1 ? 'categoría' : 'categorías'}`
  const idsVisibles = useMemo(() => new Set(arbol.flatMap((raiz) => [raiz.id, ...raiz.hijos.map((hija) => hija.id)])), [arbol])
  const sinCategorias = categorias !== null && categorias.length === 0

  return (
    <Box>
      <EncabezadoPagina
        titulo="Categorías"
        accion={puedeEditar ? <Button variant="contained" onClick={() => setEdicion({ categoria: null, padreInicial: null })}>Nueva categoría</Button> : undefined}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {aviso ? <Alert severity={aviso.severidad} onClose={() => setAviso(null)}>{aviso.texto}</Alert> : null}
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar las categorías." reintentar={() => void cargar()} />
          ) : categorias === null ? (
            <EstadoCargaPagina />
          ) : sinCategorias ? (
            <EstadoVacio
              titulo="Todavía no hay categorías."
              descripcion={puedeEditar ? 'Creá la primera con «Nueva categoría».' : undefined}
            />
          ) : (
            <>
              <BarraHerramientas
                contador={contador}
                ayuda="Una categoría se ve en las tiendas marcadas en «Visible en». El filtro sigue la tienda activa; «Limpiar filtros» muestra el árbol completo. Los productos de una categoría incluyen los de sus subcategorías."
              >
                <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" role="group" aria-label="Filtrar por tienda">
                  {errorEmpresas ? (
                    <Chip label="No pudimos cargar las tiendas" variant="outlined" disabled />
                  ) : (
                    <>
                      <Chip
                        label="Todas las tiendas"
                        clickable
                        color={empresaId === null ? 'primary' : 'default'}
                        variant={empresaId === null ? 'filled' : 'outlined'}
                        aria-pressed={empresaId === null}
                        onClick={() => elegirEmpresa(null)}
                      />
                      {empresasAccesibles.map((empresa) => (
                        <Chip
                          key={empresa.id}
                          label={empresa.nombre}
                          clickable
                          color={empresaId === empresa.id ? 'primary' : 'default'}
                          variant={empresaId === empresa.id ? 'filled' : 'outlined'}
                          aria-pressed={empresaId === empresa.id}
                          onClick={() => elegirEmpresa(empresa.id)}
                        />
                      ))}
                    </>
                  )}
                </Stack>
                <Button size="small" onClick={() => setExpandidos(new Set(conHijas))} disabled={conHijas.length === 0}>Expandir todo</Button>
                <Button size="small" onClick={() => setExpandidos(new Set())} disabled={conHijas.length === 0}>Contraer todo</Button>
                {hayFiltro ? <Button size="small" onClick={() => elegirEmpresa(null)}>Limpiar filtros</Button> : null}
              </BarraHerramientas>
              {arbol.length === 0 ? (
                <EstadoVacio titulo="No hay categorías visibles en esta tienda" descripcion="Probá con otra tienda o elegí «Todas las tiendas»." />
              ) : (
                <ArbolCategorias
                  arbol={arbol}
                  empresas={empresas}
                  alicuotas={alicuotaPorId}
                  expandidos={expandidos}
                  onAlternar={alternar}
                  puedeEditar={puedeEditar}
                  deshabilitado={ocupado}
                  onAgregarSubcategoria={(padre) => setEdicion({ categoria: null, padreInicial: padre.id })}
                  onEditar={(categoria) => setEdicion({ categoria, padreInicial: null })}
                  onEliminar={setEliminando}
                  onMover={(categoria, delta) => void aplicar(moverEnNivel(todas, categoria.id, delta, hayFiltro ? idsVisibles : undefined))}
                  onSoltar={(arrastradoId, destinoId) => void aplicar(soltarSobre(todas, arrastradoId, destinoId))}
                />
              )}
            </>
          )}
        </Stack>
      </ContenedorSeccion>
      {edicion ? (
        <FormularioCategoria
          // Una clave por apertura: el diálogo nace con los datos de la categoría elegida.
          key={edicion.categoria?.id ?? `nueva:${edicion.padreInicial ?? 'raiz'}`}
          categoria={edicion.categoria}
          padreInicial={edicion.padreInicial}
          categorias={todas}
          empresas={empresas}
          alicuotas={alicuotas}
          onCancelar={() => setEdicion(null)}
          onGuardar={guardar}
        />
      ) : null}
      {eliminando ? <EliminarCategoriaDialogo categoria={eliminando} onCancelar={() => setEliminando(null)} onConfirmar={confirmarEliminar} /> : null}
    </Box>
  )
}
