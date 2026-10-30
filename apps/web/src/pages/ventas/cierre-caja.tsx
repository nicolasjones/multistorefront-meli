import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Snackbar, Stack, TablePagination, Typography,
} from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useEsAdministrador } from '../../hooks/useEsAdministrador'
import { formatearFecha, formatearImporteHistorial } from '../../lib/formatoHistorial'
import {
  type CierreCaja,
  ETIQUETA_ESTADO,
  cerrarCaja,
  fechaDeHoy,
  listarCierresCaja,
  mensajeDeErrorCierreCaja,
  reabrirCaja,
} from '../../lib/cierreCaja'
import { CerrarCajaDialog } from '../../components/ventas/CerrarCajaDialog'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 10

type Pendiente =
  | { accion: 'cerrar'; empresaId: string; empresa: string; fecha: string }
  | { accion: 'reabrir'; cierre: CierreCaja }

// Pantalla **Cierre de caja** (F-VTA-33, FR-024, FR-025): lista de cierres por tienda y día con el
// detalle por forma de pago y cuenta. «Cerrar caja» cierra el día de la tienda activa; «Reabrir»
// habilita de nuevo los cobros. Solo el Administrador ve las acciones; la base lo exige igual.
export function CierreCajaList() {
  const {
    empresas, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId,
    cargando: cargandoTiendas, hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const { esAdministrador } = useEsAdministrador()
  const [pagina, setPagina] = useState(1)
  const [listado, setListado] = useState<{ cierres: CierreCaja[]; total: number }>({ cierres: [], total: 0 })
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  // «Última petición gana»: una respuesta vieja no pisa a la nueva.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const numero = ++peticion.current
    setCargando(true)
    setError(null)
    try {
      const datos = await listarCierresCaja(empresaId, pagina, TAMANO_PAGINA)
      if (numero !== peticion.current) return
      setListado(datos)
    } catch (excepcion) {
      if (numero !== peticion.current) return
      setError(mensajeDeErrorCierreCaja(excepcion, 'No pudimos cargar los cierres de caja. Intentá de nuevo.'))
    } finally {
      if (numero === peticion.current) setCargando(false)
    }
  }, [empresaId, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Principio VIII: al cambiar la empresa activa se reencuadra la paginación y se descarta el
  // diálogo abierto (jamás confirma un cierre de la tienda anterior bajo la nueva). El ajuste va
  // durante el render, no en un efecto.
  const [empresaDeLaPagina, setEmpresaDeLaPagina] = useState(empresaActivaId)
  if (empresaDeLaPagina !== empresaActivaId) {
    setEmpresaDeLaPagina(empresaActivaId)
    setPagina(1)
    setPendiente(null)
  }

  // «Cerrar caja» es del día de la empresa activa: sin una tienda concreta no hay qué cerrar.
  const empresaDelCierre = empresas.find((e) => e.id === empresaActivaId) ?? null
  const hoy = fechaDeHoy()

  const confirmar = async () => {
    if (!pendiente) return
    if (pendiente.accion === 'cerrar') {
      await cerrarCaja(pendiente.empresaId, pendiente.fecha)
      setAviso(`Caja cerrada · ${pendiente.empresa} · ${formatearFecha(pendiente.fecha)}`)
    } else {
      await reabrirCaja(pendiente.cierre.id)
      setAviso(`Caja reabierta · ${pendiente.cierre.empresa} · ${formatearFecha(pendiente.cierre.fecha)}`)
    }
    setPendiente(null)
    await cargar()
  }

  const columnas = useMemo<ColumnaAdaptable<CierreCaja>[]>(() => [
    { clave: 'empresa', encabezado: 'Tienda', render: (c) => c.empresa },
    { clave: 'fecha', encabezado: 'Fecha', render: (c) => formatearFecha(c.fecha) },
    { clave: 'estado', encabezado: 'Estado', render: (c) => ETIQUETA_ESTADO[c.estado] },
    {
      clave: 'total',
      encabezado: 'Total',
      align: 'right',
      render: (c) => (
        <Typography component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {formatearImporteHistorial(c.total)}
        </Typography>
      ),
    },
    {
      clave: 'detalle',
      encabezado: 'Detalle',
      render: (c) => (c.detalle.length === 0 ? '—' : (
        <Box component="ul" aria-label={`Detalle del cierre de ${c.empresa} del ${formatearFecha(c.fecha)}`} sx={{ m: 0, pl: 2 }}>
          {c.detalle.map((d) => (
            <li key={`${d.forma_pago_id}-${d.cuenta_cobro_id ?? 'sin'}`}>
              {d.forma_pago}{d.cuenta_cobro ? ` · ${d.cuenta_cobro}` : ''}: {formatearImporteHistorial(d.total)}
            </li>
          ))}
        </Box>
      )),
    },
    ...(esAdministrador ? [{
      clave: 'acciones',
      encabezado: 'Acciones',
      align: 'right' as const,
      render: (c: CierreCaja) => (c.estado === 'cerrada' ? (
        <Button
          size="small"
          onClick={() => setPendiente({ accion: 'reabrir', cierre: c })}
          aria-label={`Reabrir la caja de ${c.empresa} del ${formatearFecha(c.fecha)}`}
        >
          Reabrir
        </Button>
      ) : null),
    }] : []),
  ], [esAdministrador])

  const primeraCarga = cargando && listado.cierres.length === 0 && !error

  return (
    <Box>
      <EncabezadoPagina
        titulo="Cierre de caja"
        descripcion="Cierre diario por tienda: resume los cobros del día por forma de pago y cuenta, y bloquea su modificación hasta reabrirlo."
        contexto={<ContextoOrganizacionActiva />}
        accion={esAdministrador ? (
          <Button
            variant="contained"
            disabled={!empresaDelCierre}
            onClick={() => empresaDelCierre && setPendiente({
              accion: 'cerrar', empresaId: empresaDelCierre.id, empresa: empresaDelCierre.nombre, fecha: hoy,
            })}
          >
            Cerrar caja
          </Button>
        ) : undefined}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => { elegirEmpresa(nuevo); setPagina(1) }}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda={esAdministrador && !empresaDelCierre
              ? 'Elegí una empresa en la barra superior para cerrar la caja de hoy.'
              : 'Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda.'}
          />
          {primeraCarga ? <EstadoCargaPagina lineas={3} /> : null}
          {error ? <EstadoError descripcion={error} reintentar={() => void cargar()} /> : null}
          {error ? null : (
            <Card variant="outlined">
              <CardContent>
                <Box aria-busy={cargando}>
                  {primeraCarga ? null : listado.cierres.length === 0 ? (
                    <EstadoVacio
                      titulo="Sin cierres de caja"
                      descripcion="Cuando se cierre la caja de un día, aparece acá con su resumen."
                    />
                  ) : (
                    <ContenidoAdaptable
                      items={listado.cierres}
                      columnas={columnas}
                      obtenerClave={(c) => c.id}
                      etiquetaTabla="Cierres de caja"
                    />
                  )}
                </Box>
                <TablePagination
                  component="div"
                  count={listado.total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Cierres por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              </CardContent>
            </Card>
          )}
        </Stack>
      </ContenedorSeccion>

      {pendiente ? (
        <CerrarCajaDialog
          open
          accion={pendiente.accion}
          empresa={pendiente.accion === 'cerrar' ? pendiente.empresa : pendiente.cierre.empresa}
          fecha={formatearFecha(pendiente.accion === 'cerrar' ? pendiente.fecha : pendiente.cierre.fecha)}
          onCerrar={() => setPendiente(null)}
          onConfirmar={confirmar}
        />
      ) : null}

      <Snackbar open={aviso !== null} autoHideDuration={4000} onClose={() => setAviso(null)}>
        <Alert severity="success" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Box>
  )
}
