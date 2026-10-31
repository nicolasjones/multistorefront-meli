import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { Box, Button, Chip, LinearProgress, Stack, TablePagination, Typography } from '@mui/material'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useHistorialCorreoMasivo } from '../../../hooks/useHistorialCorreoMasivo'
import {
  ETIQUETA_ESTADO_CAMPANA, RUTA_HISTORIAL_CORREO_MASIVO, textoFechaCampana, textoProgreso, type CampanaHistorial,
} from '../../../lib/correoMasivoHistorial'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { PestanasCorreoMasivo } from './pestanas'

const TAMANO_PAGINA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const columnas: ColumnaAdaptable<CampanaHistorial>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (c) => textoFechaCampana(c.creada_en) },
  {
    clave: 'asunto', encabezado: 'Asunto',
    render: (c) => <Button component={RouterLink} to={`${RUTA_HISTORIAL_CORREO_MASIVO}/${c.id}`} size="small" aria-label={`Ver la campaña ${c.asunto}`}>{c.asunto}</Button>,
  },
  { clave: 'autor', encabezado: 'Enviada por', render: (c) => c.autor },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (c) => (
      <Stack spacing={0}>
        <Chip size="small" color={c.estado === 'en_curso' ? 'warning' : 'success'} label={ETIQUETA_ESTADO_CAMPANA[c.estado]} sx={{ alignSelf: 'flex-start' }} />
        {c.estado === 'en_curso' ? <Typography component="span" variant="xs">{textoProgreso(c)}</Typography> : null}
      </Stack>
    ),
  },
  { clave: 'destinatarios', encabezado: 'Destinatarios', align: 'right', render: (c) => c.destinatarios },
  { clave: 'enviados', encabezado: 'Enviados', align: 'right', render: (c) => c.enviados },
  { clave: 'fallidos', encabezado: 'Fallidos', align: 'right', render: (c) => c.fallidos },
  { clave: 'omitidos', encabezado: 'Omitidos', align: 'right', render: (c) => c.omitidos },
  { clave: 'bajas', encabezado: 'Bajas', align: 'right', render: (c) => c.bajas },
]

// «Correo masivo → Historial» (F-CLI-13, FR-030/FR-034/FR-035/FR-036): campañas de la empresa activa, de la más
// reciente a la más antigua, solo lectura (sin editar, borrar ni reenviar). Al cambiar de empresa se recarga, se vuelve
// a la página 1 y no queda ninguna fila ni total de la anterior (Principio VIII). Se actualiza al recargar.
export function CorreoMasivoHistorial() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const [pagina, setPagina] = useState(1)
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()

  useEffect(() => {
    setPagina(1)
  }, [empresaId])

  const { filas, total, isLoading, isFetching, isError, refetch } = useHistorialCorreoMasivo({ empresaId, pagina, tamano: TAMANO_PAGINA })

  // Si la página quedó fuera de rango, el servidor no devuelve filas: se vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && filas.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, filas.length, pagina])

  const puedeVer = nivel === 'lectura' || nivel === 'edicion'

  return (
    <Box>
      <EncabezadoPagina
        titulo="Correo masivo"
        descripcion="Lo que se envió, a cuántos clientes y con qué resultado."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null ? (
          <EstadoCargaPagina />
        ) : !puedeVer ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede ver el historial del correo masivo." />
        ) : (
          <Stack spacing={2}>
            <PestanasCorreoMasivo activa="historial" puedeCrear={nivel === 'edicion'} />
            {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
              <FiltroEmpresa
                empresas={empresas}
                valor={empresaId}
                onCambiar={(id) => { elegirEmpresa(id); setPagina(1) }}
                cargando={cargandoTiendas}
                hayError={errorTiendas}
              />
            ) : null}
            <BarraHerramientas contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'campaña' : 'campañas'}`} />
            <Box role="status" aria-live="polite" sx={visuallyHidden}>
              {isLoading || isError ? '' : `${total} ${total === 1 ? 'campaña' : 'campañas'}`}
            </Box>
            {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando el historial" sx={{ height: ALTO_BARRA_CARGA }} /> : null}
            <Box aria-busy={isFetching}>
              {isLoading ? (
                <EstadoCargaPagina />
              ) : isError ? (
                <EstadoError descripcion="No pudimos cargar el historial de campañas." reintentar={() => void refetch()} />
              ) : filas.length === 0 && pagina === 1 ? (
                <EstadoVacio titulo="Todavía no se envió ninguna campaña" />
              ) : (
                <>
                  <ContenidoAdaptable
                    items={filas}
                    columnas={columnas}
                    obtenerClave={(campana) => campana.id}
                    etiquetaTabla="Historial de campañas de correo"
                  />
                  {filas.length > 0 ? <TablePagination
                    component="div"
                    count={total}
                    page={pagina - 1}
                    rowsPerPage={TAMANO_PAGINA}
                    rowsPerPageOptions={[TAMANO_PAGINA]}
                    onPageChange={(_, nueva) => setPagina(nueva + 1)}
                    labelRowsPerPage="Campañas por página"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                  /> : null}
                </>
              )}
            </Box>
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}
