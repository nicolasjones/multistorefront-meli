import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, LinearProgress, Stack, TablePagination, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../../hooks/useFiltroPorEmpresaActiva'
import { useDestinatariosCorreoMasivo, type DestinatarioCorreoMasivo } from '../../../hooks/useDestinatariosCorreoMasivo'
import { useCorreoMasivo } from '../../../hooks/useCorreoMasivo'
import { nuevaClaveCampana, redaccionValida, validarRedaccion, type ErroresRedaccion } from '../../../lib/correoMasivo'
import { CamposRedaccionCorreo } from '../../../components/clientes/CamposRedaccionCorreo'
import { VistaPreviaCorreo } from './vista-previa'
import type { TipoCliente } from '../../../lib/clientes'
import { FiltroEmpresa } from '../../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../../components/pagina/ContenidoAdaptable'
import { BarraHerramientas } from '../../../components/pagina/BarraHerramientas'
import { ContextoOrganizacionActiva } from '../../../components/pagina/ContextoOrganizacionActiva'

const ESPERA_BUSQUEDA_MS = 300
const TAMANO_PAGINA = 25
// Barra de progreso indeterminada: alto fino propio del componente, no un valor del sistema.
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

// Lo que el listado de Clientes entrega al pulsar «Enviar correo a seleccionados (N)»: los marcados y la
// empresa activa con la que se marcaron. Si la empresa activa cambia, esa selección ya no vale (Principio VIII).
export type SeleccionDesdeListado = { clientes: string[]; empresaActivaId: string | null }

const columnas: ColumnaAdaptable<DestinatarioCorreoMasivo>[] = [
  {
    clave: 'cliente', encabezado: 'Cliente',
    render: (cliente) => (
      <Stack spacing={0}>
        <Typography component="span" sx={{ fontWeight: 600 }}>{cliente.nombre}</Typography>
        <Typography component="span" variant="xs">N.º {cliente.numero}</Typography>
      </Stack>
    ),
  },
  { clave: 'correo', encabezado: 'Correo', render: (cliente) => cliente.correo },
]

const textoExcluidos = (sinCorreo: number, noAceptan: number) => {
  const partes = [
    sinCorreo > 0 ? `${sinCorreo} sin correo` : null,
    noAceptan > 0 ? `${noAceptan} no ${noAceptan === 1 ? 'acepta' : 'aceptan'} el correo masivo` : null,
  ].filter(Boolean)
  return partes.length === 0 ? 'Ningún cliente quedó afuera.' : `Quedan afuera: ${partes.join(' y ')}.`
}

// «Correo masivo → Nueva campaña» (F-CLI-11, FR-003/FR-004/FR-007; F-CLI-12, FR-010/FR-013/FR-014/FR-015): arma el
// grupo con los mismos filtros del listado de Clientes, muestra quién lo recibiría y permite redactar, ver la vista
// previa, probar y enviar. Enviar crea una campaña con la foto de los elegibles de ese momento. Armar el grupo exige
// edición en Clientes; la base lo rechaza igual. La empresa es la de la barra superior (Principio VIII): al
// cambiarla se recargan lista y resumen, se reencuadra la paginación y se descarta la selección del listado.
export function CorreoMasivoNueva() {
  const { nivel, isLoading: verificandoPermiso } = useNivelSeccion('clientes')
  const desdeListado = (useLocation().state as SeleccionDesdeListado | null) ?? null
  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [tipo, setTipo] = useState<TipoCliente | null>(null)
  const [conCuentaWeb, setConCuentaWeb] = useState(false)
  const [pagina, setPagina] = useState(1)
  const [seleccionDescartada, setSeleccionDescartada] = useState(false)
  const [asunto, setAsunto] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [errores, setErrores] = useState<ErroresRedaccion | null>(null)
  // Clave de idempotencia de la confirmación abierta; null = no hay confirmación.
  const [claveConfirmacion, setClaveConfirmacion] = useState<string | null>(null)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [enviada, setEnviada] = useState<number | null>(null)
  const { crearCampana, enviando } = useCorreoMasivo()
  const { empresas, valor: empresaId, cambiar: elegirEmpresa, empresaActivaId, cargando: cargandoTiendas, hayError: errorTiendas } = useFiltroPorEmpresaActiva()

  // La selección vale solo mientras la empresa activa sea con la que se marcó: no hay estado que limpiar.
  const marcados = !seleccionDescartada && desdeListado !== null && desdeListado.empresaActivaId === empresaActivaId
    ? desdeListado.clientes
    : null
  const hayMarcadosDescartados = desdeListado !== null && !seleccionDescartada && marcados === null

  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  // Cambió la empresa (barra superior o píldora): se reencuadra la paginación y una confirmación abierta se cierra:
  // el diálogo nunca guarda datos de la empresa anterior bajo la nueva (Principio VIII).
  useEffect(() => {
    setPagina(1)
    setClaveConfirmacion(null)
    setErrorEnvio(null)
  }, [empresaId])

  const { filas, total, resumen, isLoading, isFetching, isError, refetch } = useDestinatariosCorreoMasivo({
    texto: textoAplicado, tipo, empresaId, conCuentaWeb, clientes: marcados, pagina, tamano: TAMANO_PAGINA,
  })

  // Si la página quedó fuera de rango, el servidor no devuelve filas: se vuelve a la primera.
  useEffect(() => {
    if (!isLoading && !isFetching && !isError && filas.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, filas.length, pagina])

  const elegibles = resumen?.elegibles ?? 0

  const pedirConfirmacion = () => {
    const encontrados = validarRedaccion(asunto, mensaje)
    setErrores(encontrados)
    setEnviada(null)
    if (!redaccionValida(encontrados)) return
    setErrorEnvio(null)
    setClaveConfirmacion(nuevaClaveCampana())
  }

  const enviar = async () => {
    if (claveConfirmacion === null || enviando) return
    const resultado = await crearCampana({ clave: claveConfirmacion, asunto, mensaje, empresaId, texto: textoAplicado, tipo, conCuentaWeb, clientes: marcados })
    if (resultado.ok) {
      setEnviada(elegibles)
      setClaveConfirmacion(null)
      setAsunto('')
      setMensaje('')
      setErrores(null)
    } else {
      setErrorEnvio(resultado.error)
    }
  }

  const hayFiltros = textoAplicado.trim() !== '' || tipo !== null || conCuentaWeb || empresaId !== null || marcados !== null

  return (
    <Box>
      <EncabezadoPagina
        titulo="Correo masivo"
        descripcion="Armá el grupo de clientes al que le vas a escribir. Solo reciben el correo quienes tienen un mail cargado y aceptan el correo masivo."
        contexto={<ContextoOrganizacionActiva />}
      />
      <ContenedorSeccion>
        {verificandoPermiso || nivel === null ? (
          <EstadoCargaPagina />
        ) : nivel !== 'edicion' ? (
          <EstadoError titulo="Sin permiso" descripcion="Tu rol no puede armar el correo masivo." />
        ) : (
          <Stack spacing={2}>
            {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
              <FiltroEmpresa
                empresas={empresas}
                valor={empresaId}
                onCambiar={(id) => { elegirEmpresa(id); setPagina(1) }}
                cargando={cargandoTiendas}
                hayError={errorTiendas}
                textoAyuda="Un cliente es de la organización y se habilita en una o más tiendas."
              />
            ) : null}
            {marcados !== null ? (
              <Alert
                severity="info"
                action={<Button color="inherit" size="small" onClick={() => { setSeleccionDescartada(true); setPagina(1) }}>Quitar selección</Button>}
              >
                {marcados.length === 1 ? 'Solo el cliente marcado en el listado.' : `Solo los ${marcados.length} clientes marcados en el listado.`}
              </Alert>
            ) : null}
            {hayMarcadosDescartados ? (
              <Alert severity="info">Cambiaste de empresa: se descartó la selección del listado.</Alert>
            ) : null}

            <BarraHerramientas
              contador={isLoading || isError ? undefined : `${total} ${total === 1 ? 'destinatario' : 'destinatarios'}`}
            >
              <TextField
                type="search"
                label="Buscar clientes"
                placeholder="Nombre, DNI/CUIT, correo, teléfono, localidad o número"
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                size="small"
                sx={{ width: 320, maxWidth: '100%' }}
              />
              <ToggleButtonGroup
                exclusive
                size="small"
                aria-label="Filtrar por tipo de cliente"
                value={tipo ?? 'todos'}
                onChange={(_, valor: string | null) => {
                  if (valor === null) return
                  setTipo(valor === 'todos' ? null : (valor as TipoCliente))
                  setPagina(1)
                }}
              >
                <ToggleButton value="todos">Todos</ToggleButton>
                <ToggleButton value="minorista">Minorista</ToggleButton>
                <ToggleButton value="mayorista">Mayorista</ToggleButton>
              </ToggleButtonGroup>
              <ToggleButton
                value="con-cuenta"
                selected={conCuentaWeb}
                onChange={() => {
                  setConCuentaWeb((actual) => !actual)
                  setPagina(1)
                }}
              >
                Con cuenta web
              </ToggleButton>
            </BarraHerramientas>

            <Box role="status" aria-live="polite">
              {isLoading || isError || resumen === null ? null : (
                <Typography variant="s">{textoExcluidos(resumen.sin_correo, resumen.no_aceptan)}</Typography>
              )}
            </Box>
            <Box role="status" aria-live="polite" sx={visuallyHidden}>
              {isLoading || isError ? '' : `${total} ${total === 1 ? 'resultado' : 'resultados'}`}
            </Box>
            {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando destinatarios" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

            <Box aria-busy={isFetching}>
              {isLoading ? (
                <EstadoCargaPagina />
              ) : isError ? (
                <EstadoError descripcion="No pudimos cargar los destinatarios." reintentar={() => void refetch()} />
              ) : filas.length === 0 && pagina === 1 ? (
                hayFiltros ? (
                  <EstadoVacio titulo="No hay destinatarios con esos criterios." descripcion="Probá con otro texto o quitá algún filtro." />
                ) : (
                  <EstadoVacio titulo="Todavía no hay clientes que acepten el correo masivo." descripcion="Marcá «Incluir en el correo masivo» en la ficha del cliente." />
                )
              ) : (
                <>
                  <ContenidoAdaptable
                    items={filas}
                    columnas={columnas}
                    obtenerClave={(cliente) => cliente.id}
                    etiquetaTabla="Destinatarios del correo masivo"
                  />
                  {filas.length > 0 ? <TablePagination
                    component="div"
                    count={total}
                    page={pagina - 1}
                    rowsPerPage={TAMANO_PAGINA}
                    rowsPerPageOptions={[TAMANO_PAGINA]}
                    onPageChange={(_, nueva) => setPagina(nueva + 1)}
                    labelRowsPerPage="Destinatarios por página"
                    labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                  /> : null}
                </>
              )}
            </Box>

            <Stack spacing={2} component="section" aria-labelledby="redaccion-correo-titulo">
              <Typography id="redaccion-correo-titulo" component="h2" variant="t2">Redactar el correo</Typography>
              <Box role="status" aria-live="polite">
                {enviada !== null ? (
                  <Alert severity="success">
                    Campaña creada: el correo se envía en lotes a {enviada} {enviada === 1 ? 'cliente' : 'clientes'}, con un límite diario. Quien se dé de baja no recibe más.
                  </Alert>
                ) : null}
              </Box>
              <CamposRedaccionCorreo idBase="nueva-campana" asunto={asunto} mensaje={mensaje} onAsunto={setAsunto} onMensaje={setMensaje} errores={errores} />
              <VistaPreviaCorreo asunto={asunto} mensaje={mensaje} />
              <Box>
                <Button variant="contained" onClick={pedirConfirmacion} disabled={isLoading || isError || elegibles === 0}>
                  Enviar correo
                </Button>
                {!isLoading && !isError && elegibles === 0 ? (
                  <Typography variant="s" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>No hay destinatarios para enviar con estos criterios.</Typography>
                ) : null}
              </Box>
            </Stack>
          </Stack>
        )}
      </ContenedorSeccion>
      <Dialog open={claveConfirmacion !== null} onClose={enviando ? undefined : () => setClaveConfirmacion(null)} aria-labelledby="confirmar-correo-titulo">
        <DialogTitle id="confirmar-correo-titulo">Enviar correo</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Se envía a {elegibles} {elegibles === 1 ? 'destinatario' : 'destinatarios'}, en lotes y con un límite diario por organización. El correo no se puede cancelar una vez creado.
          </DialogContentText>
          {errorEnvio ? <Alert severity="error" sx={{ mt: 2 }}>{errorEnvio}</Alert> : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClaveConfirmacion(null)} disabled={enviando}>Cancelar</Button>
          <Button variant="contained" onClick={() => void enviar()} disabled={enviando}>Enviar correo</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
