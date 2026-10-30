import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert, Box, Card, CardContent, FormControlLabel, Link, Snackbar, Stack, Switch, TablePagination,
  ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { Link as RouterLink } from 'react-router'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { formatearFecha, formatearImporteHistorial } from '../../../lib/formatoHistorial'
import {
  type CuentaCobroMasUsada,
  type Pago,
  type ResumenPagos,
  conciliarPago,
  cuentasCobroMasUsadas,
  listarPagos,
  mensajeDeErrorPagos,
  puedeConciliarPago,
  resumenPagos,
  revertirConciliacionPago,
} from '../../../lib/ventas/pagos'
import { CuentasCobroResumen } from '../../../components/ventas/CuentasCobroResumen'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'

// El prototipo muestra «1–9 de 386»: nueve pagos por página.
const TAMANO_PAGINA = 9
const TODAS = 'todas'

type DatosPagos = {
  pagos: Pago[]
  total: number
}

// Pantalla **Pagos** (F-VTA-13, FR-025, FR-026, FR-027, FR-028): la conciliación de los cobros
// con cuenta de cobro contra el extracto del banco. Tienda, cuenta y «Solo con saldo» se resuelven
// en el servidor (`listar_pagos`); las tres tarjetas, en `resumen_pagos`; y las cuentas del filtro
// y de la tarjeta final, en `cuentas_cobro_mas_usadas`. La base es la autoridad: ella filtra por
// empresa accesible, calcula el saldo y aplica el bloqueo optimista al conciliar.
export function PagosList() {
  const {
    empresas,
    valor: empresaId,
    cambiar: elegirEmpresa,
    empresaActivaId,
    cargando: cargandoTiendas,
    hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const [cuentaCobroId, setCuentaCobroId] = useState<string | null>(null)
  const [soloConSaldo, setSoloConSaldo] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [listado, setListado] = useState<DatosPagos>({ pagos: [], total: 0 })
  const [resumen, setResumen] = useState<ResumenPagos | null>(null)
  const [cuentas, setCuentas] = useState<CuentaCobroMasUsada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Permiso de conciliar por EMPRESA (la del pago): sin la acción `conciliar_pago` el
  // interruptor «Cobrado» va deshabilitado. Mientras no se sabe, va deshabilitado (deny por
  // defecto): la base igual lo verifica al conciliar.
  const [permisos, setPermisos] = useState<Record<string, boolean>>({})
  // El pago que se está conciliando o revirtiendo: su interruptor va deshabilitado.
  const [conciliando, setConciliando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorConciliacion, setErrorConciliacion] = useState<string | null>(null)
  // «Última petición gana»: una respuesta vieja no pisa a la nueva.
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const numero = ++peticion.current
    setCargando(true)
    setError(null)
    try {
      const [pagosCargados, resumenCargado, cuentasCargadas] = await Promise.all([
        listarPagos({ empresaId, cuentaCobroId, soloConSaldo, pagina, tamano: TAMANO_PAGINA }),
        resumenPagos(empresaId),
        cuentasCobroMasUsadas(empresaId),
      ])
      if (numero !== peticion.current) return
      setListado(pagosCargados)
      setResumen(resumenCargado)
      setCuentas(cuentasCargadas)
    } catch (excepcion) {
      if (numero !== peticion.current) return
      setError(mensajeDeErrorPagos(excepcion, 'No pudimos cargar los pagos. Intentá de nuevo.'))
    } finally {
      if (numero === peticion.current) setCargando(false)
    }
  }, [empresaId, cuentaCobroId, soloConSaldo, pagina])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // FR-028 · Principio VIII: al cambiar la empresa activa se reencuadra la paginación (la página
  // 3 de la tienda anterior no es la página 3 de la nueva). El ajuste va durante el render y no
  // en un efecto: así la pantalla pide una sola vez la página nueva, y no la vieja y la nueva.
  const [empresaDeLaPagina, setEmpresaDeLaPagina] = useState(empresaActivaId)
  if (empresaDeLaPagina !== empresaActivaId) {
    setEmpresaDeLaPagina(empresaActivaId)
    setPagina(1)
  }

  // FR-028 · Principio VIII: el filtro de cuenta que ya no existe en el filtro vigente se
  // descarta (una cuenta de la tienda anterior no es una cuenta de la nueva). El ajuste va
  // durante el render y no en un efecto: la lista se pide una sola vez, con el filtro que vale.
  if (cuentaCobroId !== null && !cuentas.some((cuenta) => cuenta.id === cuentaCobroId)) {
    setCuentaCobroId(null)
  }

  // FR-026: el permiso de conciliar se resuelve por la empresa del pago, no por la empresa
  // activa: se pide una vez por cada empresa que aparece en la página y queda cacheado.
  useEffect(() => {
    const faltantes = [...new Set(listado.pagos.map((pago) => pago.empresa_id))]
      .filter((empresa) => !(empresa in permisos))
    if (faltantes.length === 0) return
    let cancelada = false
    void Promise.all(faltantes.map(async (empresa) => {
      try {
        return [empresa, await puedeConciliarPago(empresa)] as const
      } catch {
        // Sin permiso legible: el interruptor queda deshabilitado y la base decide al conciliar.
        return [empresa, false] as const
      }
    })).then((pares) => {
      if (cancelada) return
      setPermisos((actual) => ({ ...actual, ...Object.fromEntries(pares) }))
    })
    return () => { cancelada = true }
  }, [listado.pagos, permisos])

  const cambiarFiltro = (cambiar: () => void) => {
    cambiar()
    setPagina(1)
  }

  const alternarConciliacion = useCallback(async (pago: Pago) => {
    if (conciliando !== null) return
    setConciliando(pago.id)
    setErrorConciliacion(null)
    const siguiente = !pago.conciliado
    try {
      if (siguiente) await conciliarPago(pago.id, pago.actualizado_en)
      else await revertirConciliacionPago(pago.id, pago.actualizado_en)
      setAviso(`${siguiente ? 'Pago conciliado' : 'Conciliación revertida'} · ${pago.numero}`)
      // La fila, las tarjetas y el total salen de la base: se vuelve a leer todo.
      await cargar()
    } catch (excepcion) {
      setErrorConciliacion(mensajeDeErrorPagos(
        excepcion,
        siguiente
          ? 'No pudimos conciliar el pago. Intentá de nuevo.'
          : 'No pudimos revertir la conciliación. Intentá de nuevo.',
      ))
    } finally {
      setConciliando(null)
    }
  }, [conciliando, cargar])

  const columnas = useMemo<ColumnaAdaptable<Pago>[]>(() => [
    { clave: 'fecha', encabezado: 'Fecha', render: (pago) => formatearFecha(pago.fecha.slice(0, 10)) },
    { clave: 'empresa', encabezado: 'Tienda', render: (pago) => pago.empresa },
    {
      clave: 'comprobante',
      encabezado: 'Comprobante',
      render: (pago) => (
        <Link
          component={RouterLink}
          to={`/ventas/comprobantes/${pago.comprobante_id}`}
          underline="hover"
          sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {pago.numero}
        </Link>
      ),
    },
    { clave: 'cliente', encabezado: 'Cliente', render: (pago) => pago.cliente ?? '—' },
    {
      clave: 'cuenta_cobro',
      encabezado: 'Cuenta de cobro',
      render: (pago) => (
        <Box>
          <Typography component="span" sx={{ display: 'block' }}>{pago.cuenta_cobro ?? '—'}</Typography>
          <Typography component="span" variant="xs" color="text.secondary">Cuenta de {pago.empresa}</Typography>
        </Box>
      ),
    },
    {
      clave: 'importe',
      encabezado: 'Importe',
      align: 'right',
      render: (pago) => <Typography component="span" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatearImporteHistorial(pago.importe)}</Typography>,
    },
    { clave: 'aprobado_por', encabezado: 'Aprobado por', render: (pago) => pago.aprobado_por ?? '—' },
    {
      clave: 'conciliado',
      encabezado: 'Cobrado',
      align: 'center',
      render: (pago) => {
        // Sin la acción `conciliar_pago` en la empresa del pago, el interruptor va deshabilitado
        // y no llama a la RPC: la base igual lo rechaza, pero la pantalla no ofrece lo que la
        // base va a rechazar.
        const puede = permisos[pago.empresa_id] === true
        return (
          <Switch
            size="small"
            checked={pago.conciliado}
            disabled={!puede || conciliando !== null}
            onChange={() => {
              if (!puede) return
              void alternarConciliacion(pago)
            }}
            inputProps={{ role: 'switch', 'aria-label': `Cobrado ${pago.numero}` }}
          />
        )
      },
    },
    {
      clave: 'saldo',
      encabezado: 'Saldo',
      align: 'right',
      render: (pago) => (pago.saldo > 0 ? (
        <Typography component="span" sx={{ color: 'warning.main', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {formatearImporteHistorial(pago.saldo)}
        </Typography>
      ) : (
        <Typography component="span" color="text.secondary">—</Typography>
      )),
    },
  ], [alternarConciliacion, conciliando, permisos])

  const primeraCarga = cargando && listado.pagos.length === 0 && !error

  return (
    <Box>
      <EncabezadoPagina
        titulo="Pagos"
        descripcion="Conciliación de cobros: cada pago por transferencia o depósito se aprueba contra la cuenta bancaria."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => cambiarFiltro(() => elegirEmpresa(nuevo))}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda="Por defecto se ven todas; si elegís una empresa en la barra superior, se filtra por esa tienda."
          />

          {primeraCarga ? <EstadoCargaPagina lineas={3} /> : null}
          {error ? <EstadoError descripcion={error} reintentar={() => void cargar()} /> : null}
          {errorConciliacion ? <Alert severity="error" role="alert">{errorConciliacion}</Alert> : null}

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <TarjetaKpi
              titulo="Por conciliar"
              valor={resumen ? formatearImporteHistorial(resumen.por_conciliar_importe) : '—'}
              detalle={resumen ? `${resumen.por_conciliar_cantidad} ${resumen.por_conciliar_cantidad === 1 ? 'pago sin aprobar' : 'pagos sin aprobar'}` : ''}
              color="warning.main"
            />
            <TarjetaKpi
              titulo="Conciliado"
              valor={resumen ? formatearImporteHistorial(resumen.conciliado_importe) : '—'}
              detalle={resumen ? `${resumen.conciliado_cantidad} ${resumen.conciliado_cantidad === 1 ? 'pago aprobado' : 'pagos aprobados'}` : ''}
              color="success.main"
            />
            <TarjetaKpi
              titulo="Saldo pendiente de clientes"
              valor={resumen ? formatearImporteHistorial(resumen.saldo_pendiente) : '—'}
              detalle="Comprobantes con pago parcial"
              color="text.primary"
            />
          </Stack>

          <Card variant="outlined">
            <CardContent>
              <BarraHerramientas>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  aria-label="Filtrar por cuenta de cobro"
                  value={cuentaCobroId ?? TODAS}
                  onChange={(_, valor: string | null) => {
                    if (valor === null) return
                    cambiarFiltro(() => setCuentaCobroId(valor === TODAS ? null : valor))
                  }}
                >
                  <ToggleButton value={TODAS}>Todas</ToggleButton>
                  {cuentas.map((cuenta) => (
                    <ToggleButton key={cuenta.id} value={cuenta.id}>{cuenta.nombre}</ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={soloConSaldo}
                      onChange={(evento) => cambiarFiltro(() => setSoloConSaldo(evento.target.checked))}
                    />
                  )}
                  label="Solo con saldo"
                />
              </BarraHerramientas>

              {primeraCarga ? <EstadoCargaPagina lineas={3} /> : null}
              {error ? null : (
                <Box aria-busy={cargando}>
                  {/* Mientras la consulta está en vuelo va el esqueleto de carga, no un vacío
                      falso: «Sin pagos para mostrar» recién aparece cuando la base respondió
                      (patrón compartido de carga/vacío de Cuentas de cobro y Transportes). */}
                  {primeraCarga ? null : listado.pagos.length === 0 ? (
                    <EstadoVacio
                      titulo="Sin pagos para mostrar"
                      descripcion="Cambiá de cuenta o desactivá el filtro de saldo."
                    />
                  ) : (
                    <ContenidoAdaptable
                      items={listado.pagos}
                      columnas={columnas}
                      obtenerClave={(pago) => pago.id}
                      etiquetaTabla="Pagos"
                    />
                  )}
                </Box>
              )}

              <TablePagination
                component="div"
                count={listado.total}
                page={pagina - 1}
                rowsPerPage={TAMANO_PAGINA}
                rowsPerPageOptions={[TAMANO_PAGINA]}
                onPageChange={(_, nueva) => setPagina(nueva + 1)}
                labelRowsPerPage="Pagos por página"
                labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
              />
            </CardContent>
          </Card>

          <CuentasCobroResumen
            cuentas={cuentas}
            cargando={cargando && cuentas.length === 0 && !error}
          />
        </Stack>
      </ContenedorSeccion>

      <Snackbar
        open={aviso !== null}
        autoHideDuration={4000}
        onClose={() => setAviso(null)}
      >
        <Alert severity="success" onClose={() => setAviso(null)}>
          {aviso}
        </Alert>
      </Snackbar>
    </Box>
  )
}

// Las tres tarjetas del prototipo: título, cifra y bajada.
function TarjetaKpi({ titulo, valor, detalle, color }: { titulo: string; valor: string; detalle: string; color: string }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
      <CardContent>
        <Typography component="p" variant="s">{titulo}</Typography>
        <Typography component="p" variant="kpi" sx={{ mt: 0.75, color }}>{valor}</Typography>
        <Typography component="p" variant="s" sx={{ mt: 0.25 }}>{detalle}</Typography>
      </CardContent>
    </Card>
  )
}
