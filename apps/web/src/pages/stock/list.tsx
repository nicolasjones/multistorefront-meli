import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Stack, TablePagination, Typography } from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { BarraHerramientas } from '../../components/pagina/BarraHerramientas'
import { tokens } from '../../tema/tokens'

// El diálogo no pesa en el recorrido principal: se descarga al abrirlo (Principio VI).
const NuevoMovimientoDialog = lazy(() => import('./NuevoMovimientoDialog'))

const TAMANO_PAGINA = 25

type FilaStock = {
  id: string
  nombre: string
  sku: string | null
  existencias: { cantidad: number } | { cantidad: number }[] | null
}

const cantidadDe = (fila: FilaStock): number => {
  const existencia = Array.isArray(fila.existencias) ? fila.existencias[0] : fila.existencias
  return existencia?.cantidad ?? 0
}

// Stock actual (F-STK-02, FR-009): producto, SKU y cantidad. «Nuevo movimiento» (general o
// desde una fila) solo para quien tiene edición en Stock; la autoridad es la RPC.
// Mínimo, estados y alertas llegan con F-STK-05.
export function StockList() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('stock')
  const { puedeEscribir } = usePuedeEscribir()
  const puedeEditar = !verificandoPermiso && nivel === 'edicion'
  const [filas, setFilas] = useState<FilaStock[] | null>(null)
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [hayError, setHayError] = useState(false)
  const [dialogo, setDialogo] = useState<{ abierto: boolean; productoId: string }>({ abierto: false, productoId: '' })
  const ultimaPeticion = useRef(0)

  const cargar = useCallback(async () => {
    const peticion = ++ultimaPeticion.current
    setHayError(false)
    try {
      const desde = (pagina - 1) * TAMANO_PAGINA
      const { data, error, count } = await supabaseClient
        .schema('dominio')
        .from('productos')
        .select('id, nombre, sku, existencias(cantidad)', { count: 'exact' })
        .order('nombre', { ascending: true })
        .order('id', { ascending: true })
        .range(desde, desde + TAMANO_PAGINA - 1)
        .returns<FilaStock[]>()
      if (error) throw error
      if (peticion !== ultimaPeticion.current) return
      // Si la página quedó fuera de rango, se vuelve a la primera.
      if ((data ?? []).length === 0 && pagina > 1) {
        setPagina(1)
        return
      }
      setFilas(data ?? [])
      setTotal(count ?? 0)
    } catch (error) {
      console.error('No pudimos cargar el stock.', error)
      if (peticion === ultimaPeticion.current) setHayError(true)
    }
  }, [pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const abrirDialogo = (productoId = '') => setDialogo({ abierto: true, productoId })

  const columnas: ColumnaAdaptable<FilaStock>[] = [
    {
      clave: 'producto',
      encabezado: 'Producto',
      render: (fila) => (
        <Stack spacing={0}>
          <Typography variant="b" sx={{ fontWeight: tokens.tipografia.pesoEnfasis }}>{fila.nombre}</Typography>
          <Typography variant="xs">{fila.sku ?? '—'}</Typography>
        </Stack>
      ),
    },
    { clave: 'cantidad', encabezado: 'Stock', align: 'right', render: (fila) => <Typography variant="b">{cantidadDe(fila)}</Typography> },
  ]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Stock"
        accion={
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {puedeEscribir ? <Button component={RouterLink} to="/stock/motivos" variant="outlined">Motivos de movimiento</Button> : null}
            {puedeEditar ? <Button variant="contained" onClick={() => abrirDialogo()}>Nuevo movimiento</Button> : null}
          </Stack>
        }
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          {hayError ? (
            <EstadoError descripcion="No pudimos cargar el stock." reintentar={() => void cargar()} />
          ) : filas === null ? (
            <EstadoCargaPagina />
          ) : filas.length === 0 ? (
            <EstadoVacio titulo="Todavía no hay productos para llevar stock." descripcion="Cargá productos en el catálogo y acá vas a ver su stock." />
          ) : (
            <>
              <BarraHerramientas
                contador={`${total} ${total === 1 ? 'producto' : 'productos'}`}
                ayuda="El stock es único por organización y compartido entre empresas."
              />
              <ContenidoAdaptable
                items={filas}
                columnas={columnas}
                obtenerClave={(fila) => fila.id}
                etiquetaTabla="Stock actual"
                acciones={
                  puedeEditar
                    ? (fila) => (
                        <Button size="small" variant="outlined" onClick={() => abrirDialogo(fila.id)} aria-label={`Nuevo movimiento de ${fila.nombre}`}>
                          Nuevo movimiento
                        </Button>
                      )
                    : undefined
                }
              />
              <TablePagination
                component="div"
                count={total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA}
                rowsPerPageOptions={[TAMANO_PAGINA]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Productos por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              />
            </>
          )}
        </Stack>
      </ContenedorSeccion>
      {puedeEditar && dialogo.abierto ? (
        <Suspense fallback={null}>
          <NuevoMovimientoDialog
            abierto
            productoId={dialogo.productoId}
            onCerrar={() => setDialogo({ abierto: false, productoId: '' })}
            onRegistrado={() => void cargar()}
          />
        </Suspense>
      ) : null}
    </Box>
  )
}
