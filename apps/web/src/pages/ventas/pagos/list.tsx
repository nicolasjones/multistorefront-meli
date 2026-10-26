import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Card, CardContent, FormControlLabel, Stack, Switch, TablePagination, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { formatearImporteHistorial } from '../../../lib/formatoHistorial'
import {
  type CuentaCobroMasUsada,
  type Pago,
  type ResumenPagos,
  cuentasCobroMasUsadas,
  listarPagos,
  mensajeDeErrorPagos,
  resumenPagos,
} from '../../../lib/ventas/pagos'
import { EstadoCargaPagina, EstadoError } from '../../../components/estados/EstadosPagina'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'

// El prototipo muestra «1–9 de 386»: nueve pagos por página.
const TAMANO_PAGINA = 9
const TODAS = 'todas'

type DatosPagos = {
  pagos: Pago[]
  total: number
}

// Pantalla **Pagos** (F-VTA-13, FR-025): la conciliación de los cobros con cuenta de cobro
// contra el extracto del banco. Tienda, cuenta y «Solo con saldo» se resuelven en el servidor
// (`listar_pagos`); las tres tarjetas, en `resumen_pagos`; y las cuentas del filtro, en
// `cuentas_cobro_mas_usadas`. La base es la autoridad: ella filtra por empresa accesible,
// calcula el saldo y aplica el bloqueo optimista al conciliar.
export function PagosList() {
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const [cuentaCobroId, setCuentaCobroId] = useState<string | null>(null)
  const [soloConSaldo, setSoloConSaldo] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [listado, setListado] = useState<DatosPagos>({ pagos: [], total: 0 })
  const [resumen, setResumen] = useState<ResumenPagos | null>(null)
  const [cuentas, setCuentas] = useState<CuentaCobroMasUsada[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

  const cambiarFiltro = (cambiar: () => void) => {
    cambiar()
    setPagina(1)
  }

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

          {cargando && !resumen ? <EstadoCargaPagina lineas={3} /> : null}
          {error ? <EstadoError descripcion={error} reintentar={() => void cargar()} /> : null}

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
        </Stack>
      </ContenedorSeccion>
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
