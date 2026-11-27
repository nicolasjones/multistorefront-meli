import { useEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { formatearImporte } from '../../lib/formatoImporte'
import { formatearAjuste } from '../../lib/listasPrecios'
import { supabaseClient } from '../../lib/supabase'
import { MENSAJE_SIN_VENTAS, type RangoFechas } from '../../lib/ventas-reportes'
import {
  type FilaVentasPorLista,
  NOTA_VENTAS_POR_LISTA,
  leerVentasPorLista,
  mensajeErrorVentasPorLista,
} from '../../lib/ventasPorLista'

type Props = {
  rango: RangoFechas
  empresaId: string | null
  // El filtro de empresa todavía está cargando: no se consulta hasta saber la tienda (si no, habría dos consultas).
  cargandoEmpresa: boolean
}

const columnas: ColumnaAdaptable<FilaVentasPorLista>[] = [
  { clave: 'lista', encabezado: 'Lista', render: (f) => f.listaNombre ?? 'Sin lista' },
  { clave: 'ajuste', encabezado: 'Ajuste actual', align: 'right', render: (f) => (f.ajustePctActual === null ? '—' : formatearAjuste(f.ajustePctActual)) },
  { clave: 'comprobantes', encabezado: 'Comprobantes', align: 'right', render: (f) => f.comprobantes },
  { clave: 'unidades', encabezado: 'Unidades', align: 'right', render: (f) => f.unidades },
  { clave: 'ventas', encabezado: 'Ventas netas', align: 'right', render: (f) => formatearImporte(f.ventasNetas) },
  { clave: 'ajusteOtorgado', encabezado: 'Ajuste otorgado', align: 'right', render: (f) => (f.listaId === null ? '—' : formatearImporte(f.ajusteOtorgado)) },
]

// Pestaña «Ventas por lista de precios» de Reportes de ventas (MSF-975): una fila por lista del período y una fila «Sin lista» para
// comparar. Sigue a la empresa activa de la barra superior y al período: cualquier cambio vuelve a consultar y nunca quedan filas de la
// empresa anterior. Última petición gana.
export function VentasPorLista({ rango, empresaId, cargandoEmpresa }: Props) {
  const [filas, setFilas] = useState<FilaVentasPorLista[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const ultimaPeticion = useRef(0)

  useEffect(() => {
    if (cargandoEmpresa) return
    const peticion = ++ultimaPeticion.current
    setCargando(true)
    setError(null)
    setFilas([])
    leerVentasPorLista(supabaseClient, { desde: rango.desde, hasta: rango.hasta, empresaId })
      .then((leidas) => {
        if (peticion === ultimaPeticion.current) setFilas(leidas)
      })
      .catch((excepcion: unknown) => {
        if (peticion === ultimaPeticion.current) setError(mensajeErrorVentasPorLista(excepcion))
      })
      .finally(() => {
        if (peticion === ultimaPeticion.current) setCargando(false)
      })
  }, [rango.desde, rango.hasta, empresaId, cargandoEmpresa, intento])

  return (
    <Box component="section" aria-label="Ventas por lista de precios" aria-busy={cargando || cargandoEmpresa}>
      {cargando || cargandoEmpresa ? (
        <EstadoCargaPagina />
      ) : error ? (
        <EstadoError descripcion={error} reintentar={() => setIntento((n) => n + 1)} />
      ) : filas.length === 0 ? (
        <EstadoVacio titulo={MENSAJE_SIN_VENTAS} />
      ) : (
        <>
          <ContenidoAdaptable items={filas} columnas={columnas} obtenerClave={(f) => f.listaId ?? 'sin-lista'} etiquetaTabla="Ventas por lista de precios" />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{NOTA_VENTAS_POR_LISTA}</Typography>
        </>
      )}
    </Box>
  )
}
