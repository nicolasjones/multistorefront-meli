import { useState } from 'react'
import { Alert, Box, Button, Chip, LinearProgress, Stack, Typography } from '@mui/material'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { CargaInfinita } from '../../components/pagina/CargaInfinita'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useIsSuperadmin } from '../../hooks/useIsSuperadmin'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { useProcesosMasivos } from '../../hooks/useProcesosMasivos'
import {
  avance,
  colorEstado,
  duracion,
  estaAbierto,
  etiquetaEstado,
  etiquetaFuncionalidad,
  etiquetaTipo,
  formatearFecha,
  porcentaje,
  resultado,
  type ProcesoMasivo,
} from '../../lib/procesosMasivos'
import { CancelarProceso } from './CancelarProceso'
import { DetalleImportacion } from './DetalleImportacion'
import { ExportacionTotal } from './ExportacionTotal'

const columnas: ColumnaAdaptable<ProcesoMasivo>[] = [
  { clave: 'fecha', encabezado: 'Fecha', render: (proceso) => formatearFecha(proceso.creado_en) },
  {
    clave: 'origen',
    encabezado: 'Origen',
    render: (proceso) => (
      <Box>
        <Typography component="span" display="block">{proceso.nombre}</Typography>
        <Typography component="span" variant="xs" color="text.secondary">{etiquetaTipo(proceso.tipo)} · {etiquetaFuncionalidad(proceso.funcionalidad)}</Typography>
      </Box>
    ),
  },
  { clave: 'estado', encabezado: 'Estado', render: (proceso) => <Chip size="small" color={colorEstado(proceso.estado)} label={etiquetaEstado(proceso)} /> },
  {
    clave: 'avance',
    encabezado: 'Avance',
    render: (proceso) => {
      const pct = porcentaje(proceso)
      return (
        <Box sx={{ minWidth: 120 }}>
          <Typography component="span" display="block">{avance(proceso)}</Typography>
          {estaAbierto(proceso.estado) ? (
            <LinearProgress
              variant={pct === null ? 'indeterminate' : 'determinate'}
              value={pct ?? 0}
              aria-label={`Avance de ${proceso.nombre}`}
              sx={{ mt: 0.5 }}
            />
          ) : null}
        </Box>
      )
    },
  },
  { clave: 'resultado', encabezado: 'Resultado', render: (proceso) => (proceso.procesados === 0 && proceso.con_errores === 0 ? '—' : resultado(proceso)) },
  { clave: 'duracion', encabezado: 'Duración', render: (proceso) => duracion(proceso) },
]

// Centro de importaciones y exportaciones (F-IMP-01, FR-011…FR-016): procesos masivos de la
// organización con su estado, avance y errores. Solo administradores (D-6); la RLS lo respalda.
// La empresa activa de la barra superior manda (Principio VIII): una sola fuente de verdad.
export function ImportacionesList() {
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { isSuperadmin } = useIsSuperadmin()
  const { empresas, valor: empresaFiltro, cambiar: elegirEmpresa } = useFiltroPorEmpresaActiva()
  const [detalle, setDetalle] = useState<ProcesoMasivo | null>(null)
  const [cancelando, setCancelando] = useState<ProcesoMasivo | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [empresaVista, setEmpresaVista] = useState(empresaFiltro)
  const { procesos, total, hayMas, cargandoMas, errorMas, cargarMas, isLoading, isError, refetch, refrescar } = useProcesosMasivos(empresaFiltro, puedeEscribir === true)

  // Al cambiar de empresa: el hook vuelve a la primera tanda y los diálogos cerrados con aviso, sin guardar nada de
  // la anterior bajo la nueva. Se ajusta durante el render (patrón de React) para que ni un cuadro
  // llegue a pintar datos de la empresa previa.
  if (empresaVista !== empresaFiltro) {
    setEmpresaVista(empresaFiltro)
    if (detalle || cancelando) {
      setDetalle(null)
      setCancelando(null)
      setAviso('Cambiaste de empresa, así que cerramos el cuadro que tenías abierto.')
    }
  }

  if (verificandoPermiso) return <EstadoCargaPagina />
  if (!puedeEscribir) {
    return <Alert severity="error" sx={{ m: 2 }}>Solo un administrador de la organización puede ver las importaciones y exportaciones.</Alert>
  }

  // El detalle sigue el refresco de la tabla; si el proceso salió de la página, queda lo último visto.
  const detalleActual = detalle ? procesos.find((proceso) => proceso.id === detalle.id) ?? detalle : null

  return (
    <Box>
      <EncabezadoPagina
        titulo="Importaciones"
        descripcion="Cargas y descargas masivas de la organización, con su avance y sus errores."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {/* Toda la organización: no depende de la empresa activa ni del filtro de abajo (F-OPS-06, FR-039). */}
        {/* La copia completa de datos la pide solo el administrador de la propia organización; un superadmin con acceso de soporte no (la base lo rechaza). */}
        {isSuperadmin === false ? <ExportacionTotal onSolicitada={() => void refrescar()} /> : null}
        <Stack sx={{ mb: 2 }}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaFiltro}
            onCambiar={(nueva) => {
              elegirEmpresa(nueva)
            }}
          />
        </Stack>
        {aviso ? <Alert severity="info" onClose={() => setAviso(null)} sx={{ mb: 2 }}>{aviso}</Alert> : null}

        {isLoading ? (
          <EstadoCargaPagina />
        ) : isError ? (
          <EstadoError descripcion="No pudimos cargar las importaciones y exportaciones." reintentar={() => void refetch()} />
        ) : procesos.length === 0 ? (
          <EstadoVacio
            titulo="Todavía no hay importaciones ni exportaciones."
            descripcion="Cuando alguien cargue o descargue datos de forma masiva, vas a ver acá cómo va."
          />
        ) : (
          <>
            <ContenidoAdaptable
              items={procesos}
              columnas={columnas}
              obtenerClave={(proceso) => proceso.id}
              etiquetaTabla="Importaciones y exportaciones"
              acciones={(proceso) => (
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" onClick={() => setDetalle(proceso)} aria-label={`Ver detalle de ${proceso.nombre}`}>Ver detalle</Button>
                  {estaAbierto(proceso.estado) && !proceso.cancelacion_solicitada ? (
                    <Button size="small" color="error" onClick={() => setCancelando(proceso)} aria-label={`Cancelar ${proceso.nombre}`}>Cancelar</Button>
                  ) : null}
                </Stack>
              )}
            />
            <Typography color="text.secondary" aria-live="polite" sx={{ mt: 1 }}>Mostrando {procesos.length} de {total} procesos</Typography>
            <CargaInfinita hayMas={hayMas} cargando={cargandoMas} hayError={errorMas} onCargarMas={cargarMas} />
          </>
        )}
      </ContenedorSeccion>

      {detalleActual ? <DetalleImportacion proceso={detalleActual} onCerrar={() => setDetalle(null)} /> : null}
      {cancelando ? (
        <CancelarProceso
          proceso={cancelando}
          onCerrar={() => setCancelando(null)}
          onResuelto={(resultado) => {
            void refrescar()
            if (resultado === 'terminado') return
            setCancelando(null)
            setAviso(resultado === 'cancelado' ? 'Cancelamos el proceso.' : 'Pedimos cancelar el proceso: se frena en cuanto termine el lote que está procesando.')
          }}
        />
      ) : null}
    </Box>
  )
}
