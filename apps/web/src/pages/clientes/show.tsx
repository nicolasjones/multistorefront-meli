import { Suspense, lazy, useState } from 'react'
import { Link as RouterLink, useLocation, useParams } from 'react-router'
import { useOne, useUpdate } from '@refinedev/core'
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, FormControlLabel, Stack, Switch, Tab, Tabs, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useEmpresas } from '../../hooks/useEmpresas'
import { useEmpresasDeCliente } from '../../hooks/useEmpresasDeCliente'
import { useCuentasWebDeCliente } from '../../hooks/useCuentasWebDeCliente'
import { useEmpresasAccesibles } from '../../hooks/useEmpresasAccesibles'
import { type Cliente, mensajeDeError } from '../../lib/clientes'
import {
  cambiarEstadoCuentaWeb, habilitarTiendaDeCliente, invitarCuentaWeb, tiendaCuentaWeb, type TiendaCuentaWeb,
} from '../../lib/cuentasCliente'
import { BloqueCuentaWeb } from '../../components/clientes/BloqueCuentaWeb'
import { BloqueTiendas } from '../../components/clientes/BloqueTiendas'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { TituloDialogo } from '../../components/base/TituloDialogo'
import { ComprasCliente } from '../../components/clientes/ComprasCliente'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'

// Pestaña de Service técnico (F-SVC-15): se descarga solo al abrirla (Principio VI).
const ReparacionesDeCliente = lazy(() => import('../../components/clientes/ReparacionesDeCliente').then((modulo) => ({ default: modulo.ReparacionesDeCliente })))

const DATOS: ReadonlyArray<{ campo: keyof Cliente; etiqueta: string }> = [
  { campo: 'documento', etiqueta: 'DNI/CUIT' },
  { campo: 'correo', etiqueta: 'Correo' },
  { campo: 'telefono', etiqueta: 'Teléfono' },
  { campo: 'celular', etiqueta: 'Celular' },
  { campo: 'direccion', etiqueta: 'Dirección' },
  { campo: 'codigo_postal', etiqueta: 'Código postal' },
  { campo: 'localidad', etiqueta: 'Localidad' },
  { campo: 'provincia', etiqueta: 'Provincia' },
  { campo: 'expreso_preferido', etiqueta: 'Expreso preferido' },
  { campo: 'descuento', etiqueta: 'Descuento' },
]

// Ficha de cliente (F-CLI-01, FR-003): datos, estado y, para quien edita,
// Editar y Archivar/Restaurar con confirmación. No existe «Eliminar».
export function ClienteShow() {
  const { id } = useParams()
  const location = useLocation()
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const { nivel: nivelService } = useNivelSeccion('service_tecnico')
  const [pestana, setPestana] = useState<'datos' | 'reparaciones'>('datos')
  const { query } = useOne<Cliente>({ resource: 'clientes', id })
  const { mutateAsync } = useUpdate()
  const [confirmando, setConfirmando] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<string | null>((location.state as { mensaje?: string } | null)?.mensaje ?? null)
  const [mensajeCuenta, setMensajeCuenta] = useState<string | null>(null)
  const [errorCuenta, setErrorCuenta] = useState<string | null>(null)
  const [procesandoCuenta, setProcesandoCuenta] = useState<string | null>(null)
  const [seleccionTienda, setSeleccionTienda] = useState<{ base: string | null; valor: string } | null>(null)

  const cliente = query.data?.data
  // Tiendas del cliente (F-CLI-05): ids de la relación, nombres del catálogo.
  const { empresas: catalogo, isLoading: cargandoCatalogo, isError: errorCatalogo } = useEmpresas()
  const { empresas: tiendasIds, isLoading: cargandoTiendas, isError: errorTiendas, refetch: reintentarTiendas } = useEmpresasDeCliente(cliente?.id)
  const { cuentas, isLoading: cargandoCuentas, isError: errorCuentas, refetch: reintentarCuentas } = useCuentasWebDeCliente(cliente?.id)
  // Empresa activa de la barra superior (Principio VIII, FR-017): la ficha se
  // reencuadra a esa tienda al cambiarla y descarta la pestaña de la anterior.
  const { empresaActivaId } = useEmpresasAccesibles()
  const tiendasCuenta: TiendaCuentaWeb[] = catalogo.map((empresa) =>
    tiendaCuentaWeb(empresa, tiendasIds, cuentas, cliente?.correo ?? null))
  const porDefecto = tiendasCuenta.find((tienda) => tienda.empresaId === empresaActivaId)?.empresaId
    ?? tiendasCuenta[0]?.empresaId ?? null
  const tiendaSeleccionada = seleccionTienda && seleccionTienda.base === empresaActivaId
    ? seleccionTienda.valor
    : porDefecto
  const cargandoCuentaWeb = cargandoCatalogo || cargandoTiendas || cargandoCuentas
  const errorCuentaWeb = errorCatalogo || errorTiendas || errorCuentas
  // El Consumidor final es del mostrador: la base lo hace inmutable (FR-009) y acá no se ofrecen acciones.
  const puedeEditar = nivel === 'edicion' && !cliente?.es_consumidor_final
  const archivado = Boolean(cliente?.archivado_en)
  // Sin acceso a Service técnico la pestaña no existe (FR-045); si se pierde el acceso, vuelve a «Datos».
  const verReparaciones = nivelService === 'lectura' || nivelService === 'edicion'
  const pestanaActiva = verReparaciones ? pestana : 'datos'

  const cambiarArchivado = async () => {
    if (!cliente || procesando) {
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      await mutateAsync({
        resource: 'clientes',
        id: cliente.id,
        values: { archivado_en: archivado ? null : new Date().toISOString() },
        successNotification: false,
      })
      setConfirmacion(archivado ? 'Cliente restaurado' : 'Cliente archivado')
      setConfirmando(false)
    } catch (error) {
      setErrorAccion(mensajeDeError(error, 'No pudimos completar la acción.'))
    } finally {
      setProcesando(false)
    }
    // Fuera del try: si el refetch falla, el cambio ya se guardó y no es un error de la acción.
    await query.refetch().catch(() => undefined)
  }

  // Bloque «Comunicaciones» (F-CLI-11, FR-002): el interruptor guarda al instante, como las tiendas.
  const cambiarCorreoMasivo = async (acepta: boolean) => {
    if (!cliente || procesando) {
      return
    }
    setProcesando(true)
    setErrorAccion(null)
    try {
      await mutateAsync({
        resource: 'clientes',
        id: cliente.id,
        values: { acepta_correo_masivo: acepta },
        successNotification: false,
      })
      setConfirmacion(acepta ? 'El cliente se incluye en el correo masivo' : 'El cliente ya no se incluye en el correo masivo')
    } catch (error) {
      setErrorAccion(mensajeDeError(error, 'No pudimos guardar la preferencia de correo masivo.'))
    } finally {
      setProcesando(false)
    }
    await query.refetch().catch(() => undefined)
  }

  const ejecutarCuenta = async (empresaId: string, accion: () => Promise<void>, mensaje: string) => {
    setProcesandoCuenta(empresaId)
    setErrorCuenta(null)
    setMensajeCuenta(null)
    try {
      await accion()
      setMensajeCuenta(mensaje)
    } catch (error) {
      setErrorCuenta(error instanceof Error ? error.message : 'No pudimos completar la acción.')
    } finally {
      setProcesandoCuenta(null)
      await Promise.all([reintentarCuentas(), reintentarTiendas()]).catch(() => undefined)
    }
  }

  const nombreTienda = (empresaId: string) => tiendasCuenta.find((tienda) => tienda.empresaId === empresaId)?.nombre ?? 'la tienda'

  const habilitarTienda = (empresaId: string, habilitada: boolean) => {
    if (!cliente) return
    void ejecutarCuenta(
      empresaId,
      () => habilitarTiendaDeCliente(cliente.id, empresaId, habilitada).then(() => undefined),
      habilitada ? `Cliente habilitado en ${nombreTienda(empresaId)}` : `Cliente deshabilitado en ${nombreTienda(empresaId)}`,
    )
  }

  const accion = (
    <Stack direction="row" spacing={1}>
      <Button component={RouterLink} to="/clientes">Volver al listado</Button>
      {puedeEditar && cliente ? (
        <>
          <Button component={RouterLink} to={`/clientes/edit/${cliente.id}`} variant="contained">Editar</Button>
          <Button variant="outlined" color={archivado ? 'primary' : 'warning'} onClick={() => setConfirmando(true)}>
            {archivado ? 'Restaurar' : 'Archivar'}
          </Button>
        </>
      ) : null}
    </Stack>
  )

  return (
    <Box>
      <EncabezadoPagina
        titulo={cliente?.nombre ?? 'Cliente'}
        descripcion={cliente ? `Cliente Nº ${cliente.numero}` : undefined}
        accion={accion}
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {query.isLoading || verificandoPermiso ? (
          <EstadoCargaPagina />
        ) : query.isError ? (
          <EstadoError descripcion="No pudimos cargar el cliente." reintentar={() => void query.refetch()} />
        ) : !cliente ? (
          <EstadoError titulo="Cliente no encontrado" descripcion="No existe o no pertenece a tu organización." />
        ) : (
          <Stack spacing={2}>
            {confirmacion ? <EstadoExito titulo={confirmacion} /> : null}
            {errorAccion ? <EstadoError titulo="No se completó la acción." descripcion={errorAccion} /> : null}
            <Stack direction="row" spacing={1} role="status">
              <EtiquetaEstado texto={archivado ? 'Archivado' : 'Activo'} variante={archivado ? 'aviso' : 'exito'} />
              <EtiquetaEstado texto={cliente.tipo === 'mayorista' ? 'Mayorista' : 'Minorista'} variante="neutral" />
              {cliente.es_consumidor_final ? <EtiquetaEstado texto="Cliente de mostrador" variante="neutral" /> : null}
            </Stack>
            {cliente.es_consumidor_final ? (
              <Typography color="text.secondary">
                El Consumidor final se usa para vender en el mostrador sin cargar un cliente cada vez. No se edita ni se archiva.
              </Typography>
            ) : null}
            {verReparaciones ? (
              <Tabs value={pestanaActiva} onChange={(_, valor: 'datos' | 'reparaciones') => setPestana(valor)} aria-label="Secciones de la ficha">
                <Tab value="datos" label="Datos" id="pestana-cliente-datos" aria-controls="panel-cliente-datos" />
                <Tab value="reparaciones" label="Reparaciones" id="pestana-cliente-reparaciones" aria-controls="panel-cliente-reparaciones" />
              </Tabs>
            ) : null}
            {pestanaActiva === 'reparaciones' ? (
              <Box role="tabpanel" id="panel-cliente-reparaciones" aria-labelledby="pestana-cliente-reparaciones">
                <Suspense fallback={<EstadoCargaPagina />}>
                  <ReparacionesDeCliente key={cliente.id} clienteId={cliente.id} />
                </Suspense>
              </Box>
            ) : (
              <Stack spacing={2} role={verReparaciones ? 'tabpanel' : undefined} id={verReparaciones ? 'panel-cliente-datos' : undefined} aria-labelledby={verReparaciones ? 'pestana-cliente-datos' : undefined}>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '12rem 1fr' }, gap: 1 }}>
              {DATOS.map(({ campo, etiqueta }) => (
                <Box key={campo} sx={{ display: 'contents' }}>
                  <Typography component="dt" color="text.secondary">{etiqueta}</Typography>
                  <Typography component="dd" sx={{ m: 0 }}>{campo === 'descuento' ? (cliente.descuento ? `${cliente.descuento} %` : '—') : (cliente[campo] as string | null) || '—'}</Typography>
                </Box>
              ))}
            </Box>
            <Box component="section" aria-labelledby="titulo-comunicaciones">
              <Typography component="h2" variant="subtitle2" id="titulo-comunicaciones" sx={{ fontWeight: 600 }}>Comunicaciones</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={cliente.acepta_correo_masivo}
                    disabled={!puedeEditar || procesando}
                    onChange={(evento) => void cambiarCorreoMasivo(evento.target.checked)}
                  />
                }
                label="Incluir en el correo masivo"
              />
            </Box>
            {nivel === 'lectura' || nivel === 'edicion' ? (
              <>
                {mensajeCuenta ? <EstadoExito titulo={mensajeCuenta} /> : null}
                {errorCuenta ? <EstadoError titulo="No se completó la acción." descripcion={errorCuenta} /> : null}
                {cargandoCuentaWeb ? (
                  <EstadoCargaPagina />
                ) : errorCuentaWeb ? (
                  <EstadoError
                    descripcion="No pudimos cargar las tiendas y las cuentas web."
                    reintentar={() => { void reintentarTiendas(); void reintentarCuentas() }}
                  />
                ) : (
                  <>
                    <BloqueTiendas
                      tiendas={tiendasCuenta}
                      puedeEditar={puedeEditar}
                      procesando={procesandoCuenta}
                      onCambiarHabilitada={habilitarTienda}
                    />
                    <BloqueCuentaWeb
                      tiendas={tiendasCuenta}
                      seleccionada={tiendaSeleccionada}
                      onSeleccionar={(empresaId) => setSeleccionTienda({ base: empresaActivaId, valor: empresaId })}
                      puedeEditar={puedeEditar}
                      procesando={procesandoCuenta}
                      onCrear={(empresaId) => void ejecutarCuenta(
                        empresaId,
                        () => invitarCuentaWeb(cliente.id, empresaId, 'crear'),
                        `Cuenta creada en ${nombreTienda(empresaId)}: se envió el enlace para definir la clave`,
                      )}
                      onRestablecer={(empresaId) => void ejecutarCuenta(
                        empresaId,
                        () => invitarCuentaWeb(cliente.id, empresaId, 'restablecer'),
                        'Enlace para definir una nueva clave enviado',
                      )}
                      onSuspender={(empresaId) => void ejecutarCuenta(
                        empresaId,
                        () => cambiarEstadoCuentaWeb(cliente.id, empresaId, 'suspendida'),
                        `Cuenta web suspendida en ${nombreTienda(empresaId)}`,
                      )}
                      onReactivar={(empresaId) => void ejecutarCuenta(
                        empresaId,
                        () => cambiarEstadoCuentaWeb(cliente.id, empresaId, 'activa'),
                        `Cuenta web reactivada en ${nombreTienda(empresaId)}`,
                      )}
                      onHabilitar={(empresaId) => habilitarTienda(empresaId, true)}
                    />
                  </>
                )}
                <ComprasCliente key={cliente.id} clienteId={cliente.id} />
              </>
            ) : null}
              </Stack>
            )}
          </Stack>
        )}
      </ContenedorSeccion>
      <Dialog open={confirmando} onClose={() => !procesando && setConfirmando(false)} aria-labelledby="titulo-confirmar-archivado">
        <TituloDialogo id="titulo-confirmar-archivado" onCerrar={() => !procesando && setConfirmando(false)}>{archivado ? 'Restaurar cliente' : 'Archivar cliente'}</TituloDialogo>
        <DialogContent>
          <DialogContentText>
            {archivado
              ? 'El cliente vuelve al listado activo con sus datos y su número.'
              : 'El cliente deja de verse en el listado por defecto. No se pierde ningún dato y podés restaurarlo cuando quieras.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmando(false)} disabled={procesando}>Cancelar</Button>
          <Button onClick={() => void cambiarArchivado()} variant="contained" disabled={procesando} autoFocus>
            {procesando ? 'Procesando…' : archivado ? 'Restaurar' : 'Archivar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
