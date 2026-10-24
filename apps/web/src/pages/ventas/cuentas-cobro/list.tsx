import { useEffect, useState } from 'react'
import { Alert, Box, Button, Chip, LinearProgress, Stack, TablePagination, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useListarCuentasCobro } from '../../../hooks/useListarCuentasCobro'
import { usePuedeEscribir } from '../../../hooks/usePuedeEscribir'
import { formatearCuit } from '../../../lib/cuit'
import {
  type CuentaCobro,
  type EstadoCuentasCobro,
  cambiarEstadoCuentaCobro,
  mensajeDeError,
} from '../../../lib/ventas/cuentasCobro'
import { CuentaCobroDialog } from '../../../components/ventas/CuentaCobroDialog'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EtiquetaEstado } from '../../../components/base/EtiquetaEstado'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'

const TAMANO_PAGINA = 10
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2

const ESTADOS: ReadonlyArray<{ valor: EstadoCuentasCobro; etiqueta: string }> = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'activas', etiqueta: 'Activas' },
  { valor: 'no_usar', etiqueta: 'No usar' },
]

const columnas: ColumnaAdaptable<CuentaCobro>[] = [
  { clave: 'nombre', encabezado: 'Cuenta', render: (cuenta) => <Typography component="span" sx={{ fontWeight: 600 }}>{cuenta.nombre}</Typography> },
  { clave: 'titular', encabezado: 'Titular', render: (cuenta) => cuenta.titular ?? '—' },
  { clave: 'banco', encabezado: 'Banco', render: (cuenta) => cuenta.banco ?? '—' },
  { clave: 'cbu', encabezado: 'CBU', render: (cuenta) => cuenta.cbu ?? '—' },
  { clave: 'cuit', encabezado: 'CUIT', render: (cuenta) => (cuenta.cuit ? formatearCuit(cuenta.cuit) : '—') },
  {
    clave: 'disponible_en', encabezado: 'Disponible en',
    render: (cuenta) => cuenta.empresas.length === 0 ? '—' : (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        {cuenta.empresas.map((empresa) => <Chip key={empresa.id} label={empresa.nombre} size="small" variant="outlined" />)}
      </Stack>
    ),
  },
  {
    clave: 'estado', encabezado: 'Estado',
    render: (cuenta) => <EtiquetaEstado texto={cuenta.activa ? 'Activa' : 'No usar'} variante={cuenta.activa ? 'exito' : 'error'} />,
  },
]

// Pantalla `Cuentas de cobro` (F-VTA-03, FR-014). Quien tiene `ventas` la ve; solo el Administrador suma
// «Nueva cuenta de cobro», edita y marca «No usar» (la base rechaza igual cualquier escritura directa).
// Tienda y estado se resuelven en el servidor (`listar_cuentas_cobro`); la tienda sigue a la empresa activa
// de la barra superior y se puede sobreescribir con los chips.
export function CuentasCobroList() {
  const { puedeEscribir } = usePuedeEscribir()
  const puedeEditar = puedeEscribir === true
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()
  const [estado, setEstado] = useState<EstadoCuentasCobro>('todas')
  const [pagina, setPagina] = useState(1)
  // `null` = cerrado; `'nueva'` = alta; una cuenta = edición.
  const [dialogo, setDialogo] = useState<CuentaCobro | 'nueva' | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)
  const [cambiando, setCambiando] = useState<string | null>(null)

  const { cuentas, total, isLoading, isFetching, isError, refetch } = useListarCuentasCobro({
    empresaId, estado, pagina, tamano: TAMANO_PAGINA,
  })

  // Página fuera de rango (p. ej. se marcó «No usar» la última de la última página): vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && cuentas.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, cuentas.length, pagina])

  const hayFiltros = estado !== 'todas' || empresaId !== null

  const alternarEstado = async (cuenta: CuentaCobro) => {
    if (cambiando) return
    setAviso(null)
    setErrorEstado(null)
    setCambiando(cuenta.id)
    try {
      await cambiarEstadoCuentaCobro(cuenta.id, !cuenta.activa)
      setAviso(cuenta.activa ? 'Cuenta marcada como No usar' : 'Cuenta reactivada')
      await refetch()
    } catch (error) {
      setErrorEstado(mensajeDeError(error, 'No pudimos cambiar el estado de la cuenta. Intentá de nuevo.'))
    } finally {
      setCambiando(null)
    }
  }

  const nueva = puedeEditar ? <Button variant="contained" onClick={() => { setAviso(null); setDialogo('nueva') }}>Nueva cuenta de cobro</Button> : undefined

  return (
    <Box>
      <EncabezadoPagina
        titulo="Cuentas de cobro"
        descripcion="Cuentas bancarias y billeteras donde se cobran las ventas por transferencia o depósito bancario. No son depósitos de mercadería."
        accion={nueva}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <Alert severity="info" role="note">
            Una cuenta marcada como <b>No usar</b> no se ofrece al cargar un comprobante, pero conserva su historial de pagos. Se concilian en Ventas · Pagos.
          </Alert>
          {aviso ? <EstadoExito titulo={aviso} /> : null}
          {errorEstado ? <Alert severity="error">{errorEstado}</Alert> : null}

          <FiltroEmpresa
            empresas={empresas}
            valor={empresaId}
            onCambiar={(nuevo) => {
              elegirEmpresa(nuevo)
              setPagina(1)
            }}
            cargando={cargandoTiendas}
            hayError={errorTiendas}
            textoAyuda="Cada cuenta indica en qué tiendas se ofrece al cobrar. Si elegís una empresa en la barra superior, se ven las suyas."
          />

          <BarraHerramientas
            contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'cuenta' : 'cuentas'}`}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              aria-label="Filtrar por estado"
              value={estado}
              onChange={(_, valor: EstadoCuentasCobro | null) => {
                if (valor === null) return
                setEstado(valor)
                setPagina(1)
              }}
            >
              {ESTADOS.map(({ valor, etiqueta }) => <ToggleButton key={valor} value={valor}>{etiqueta}</ToggleButton>)}
            </ToggleButtonGroup>
          </BarraHerramientas>

          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando cuentas de cobro" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar las cuentas de cobro." reintentar={() => void refetch()} />
            ) : cuentas.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados" descripcion="Probá con otra tienda o con otro estado." />
              ) : (
                <EstadoVacio
                  titulo="Todavía no hay cuentas de cobro cargadas."
                  descripcion={puedeEditar ? 'Creá la primera para empezar.' : undefined}
                  accion={nueva}
                />
              )
            ) : (
              <>
                <ContenidoAdaptable
                  items={cuentas}
                  columnas={columnas}
                  obtenerClave={(cuenta) => cuenta.id}
                  etiquetaTabla="Cuentas de cobro"
                  acciones={puedeEditar ? (cuenta) => (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        aria-label={`Editar ${cuenta.nombre}`}
                        onClick={() => { setAviso(null); setDialogo(cuenta) }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        aria-label={`${cuenta.activa ? 'Marcar No usar' : 'Reactivar'} ${cuenta.nombre}`}
                        disabled={cambiando !== null}
                        onClick={() => void alternarEstado(cuenta)}
                      >
                        {cuenta.activa ? 'Marcar No usar' : 'Reactivar'}
                      </Button>
                    </Stack>
                  ) : undefined}
                />
                <TablePagination
                  component="div"
                  count={total}
                  page={pagina - 1}
                  rowsPerPage={TAMANO_PAGINA}
                  rowsPerPageOptions={[TAMANO_PAGINA]}
                  onPageChange={(_, nueva) => setPagina(nueva + 1)}
                  labelRowsPerPage="Cuentas por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {puedeEditar && dialogo !== null ? (
        <CuentaCobroDialog
          open
          cuenta={dialogo === 'nueva' ? null : dialogo}
          onCerrar={() => setDialogo(null)}
          onRecargar={() => { setDialogo(null); void refetch() }}
          onGuardado={({ alta }) => {
            setDialogo(null)
            setAviso(alta ? 'Cuenta de cobro creada' : 'Cuenta de cobro guardada')
            // La nueva aparece en el listado: vuelve al inicio con la lista vigente.
            if (alta) setPagina(1)
            void refetch()
          }}
        />
      ) : null}
    </Box>
  )
}
