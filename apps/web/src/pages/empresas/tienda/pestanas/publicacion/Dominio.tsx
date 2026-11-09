import { useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material'
import { useWarnAboutChange } from '@refinedev/core'
import { useDominioTienda } from '../../../../../hooks/useDominioTienda'
import {
  ErrorConfigurarDominio, ErrorVerificarDominio, configurarDominio, normalizarDominio, textoUltimaVerificacion,
  validarDominios, verificarDominio, type DominioTienda, type ErroresDominio, type EstadoCertificado, type EstadoRegistro,
} from '../../../../../lib/tiendaDominio'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../../../components/estados/EstadosPagina'
import type { PropsPestanaTienda } from '../../pestanas'

// F-TDA-05 (US1, FR-001…FR-018): sección «Dominio» de «Dominio y publicación». Orden dentro de la pestaña.
export const orden = 10

const ESTADO_REGISTRO: Record<EstadoRegistro, { etiqueta: string; color: 'success' | 'warning' | 'error' }> = {
  correcto: { etiqueta: 'Correcto', color: 'success' },
  incorrecto: { etiqueta: 'Incorrecto', color: 'error' },
  pendiente: { etiqueta: 'Pendiente', color: 'warning' },
}

const CERTIFICADO: Record<EstadoCertificado, { etiqueta: string; color: 'success' | 'warning' | 'error' }> = {
  activo: { etiqueta: 'Certificado SSL activo', color: 'success' },
  pendiente: { etiqueta: 'Certificado pendiente', color: 'warning' },
  error: { etiqueta: 'Certificado con error', color: 'error' },
}

const MENSAJE_FALLO: Record<ErrorVerificarDominio['motivo'], string> = {
  demasiado_pronto: 'Esperá unos segundos antes de verificar de nuevo.',
  dns_no_disponible: 'No se pudo verificar ahora, probá de nuevo.',
  sin_permiso: 'No tenés permiso para verificar el dominio de esta tienda.',
  otro: 'No pudimos verificar el dominio. Intentá de nuevo.',
}

type Aviso = { severidad: 'success' | 'info' | 'error'; texto: string; alerta?: boolean }

function Formulario({ empresaId, dominio, alCambiarDominio, recargar }: {
  empresaId: string
  dominio: DominioTienda
  alCambiarDominio?: () => void
  recargar: () => Promise<void>
}) {
  const { setWarnWhen } = useWarnAboutChange()
  // El campo principal edita el dominio «en curso»: el pendiente si lo hay, si no el vigente.
  const guardadoPrincipal = dominio.dominioPendiente ?? dominio.dominioVigente ?? ''
  const guardadoRedireccion = dominio.redireccion ?? ''
  const [principal, setPrincipal] = useState(guardadoPrincipal)
  const [redireccion, setRedireccion] = useState(guardadoRedireccion)
  const [errores, setErrores] = useState<ErroresDominio>({})
  const [guardando, setGuardando] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [aviso, setAviso] = useState<Aviso | null>(null)
  const [ahora] = useState(() => new Date())

  // Tras guardar o verificar, el servidor puede haber normalizado o cambiado lo guardado: el formulario lo sigue.
  const guardadoClave = `${guardadoPrincipal}|${guardadoRedireccion}`
  const [claveVista, setClaveVista] = useState(guardadoClave)
  if (claveVista !== guardadoClave) {
    setClaveVista(guardadoClave)
    setPrincipal(guardadoPrincipal)
    setRedireccion(guardadoRedireccion)
  }

  const hayCambios = useMemo(
    () => normalizarDominio(principal) !== guardadoPrincipal || normalizarDominio(redireccion) !== guardadoRedireccion,
    [principal, redireccion, guardadoPrincipal, guardadoRedireccion],
  )

  // Con cambios sin guardar, la gestión avisa antes de cambiar de empresa (Principio VIII, FR-018).
  useEffect(() => {
    setWarnWhen(hayCambios)
    return () => setWarnWhen(false)
  }, [hayCambios, setWarnWhen])

  const guardar = async () => {
    const encontrados = validarDominios(principal, redireccion)
    if (Object.keys(encontrados).length > 0) {
      setErrores(encontrados)
      setAviso(null)
      return
    }
    setGuardando(true)
    setErrores({})
    setAviso(null)
    try {
      await configurarDominio(empresaId, principal, redireccion)
      await recargar()
      alCambiarDominio?.()
      const nuevoPrincipal = normalizarDominio(principal)
      setAviso(
        dominio.dominioVigente && nuevoPrincipal !== dominio.dominioVigente
          ? { severidad: 'info', texto: `El dominio nuevo queda pendiente de verificación: la tienda sigue respondiendo en ${dominio.dominioVigente} hasta que se verifique.` }
          : { severidad: 'success', texto: 'Dominio guardado.' },
      )
    } catch (error) {
      console.error('No se pudo guardar el dominio de la tienda', error instanceof Error ? error.message : error)
      if (error instanceof ErrorConfigurarDominio && error.campo) {
        setErrores({ [error.campo]: error.message })
      } else {
        setAviso({ severidad: 'error', texto: 'No pudimos guardar el dominio. Intentá de nuevo.' })
      }
    }
    setGuardando(false)
  }

  const verificar = async () => {
    setVerificando(true)
    setAviso(null)
    try {
      const resultado = await verificarDominio(empresaId)
      await recargar()
      if (resultado.dominioVerificado) {
        alCambiarDominio?.()
        setAviso({ severidad: 'success', texto: 'DNS verificado correctamente' })
      } else {
        setAviso({ severidad: 'error', texto: 'El DNS todavía no coincide: revisá los registros marcados e intentá de nuevo.' })
      }
    } catch (error) {
      console.error('No se pudo verificar el dominio de la tienda', error instanceof Error ? error.message : error)
      setAviso({ severidad: 'error', texto: MENSAJE_FALLO[error instanceof ErrorVerificarDominio ? error.motivo : 'otro'] })
    }
    setVerificando(false)
  }

  const conTienda = dominio.dominioVigente !== null

  return (
    <Stack spacing={2}>
      {!conTienda ? (
        <EstadoVacio titulo="Esta empresa todavía no tiene dominio" descripcion="Cargá el dominio principal para conectar la tienda." />
      ) : null}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
        <TextField
          label="Dominio principal"
          value={principal}
          onChange={(evento) => { setPrincipal(evento.target.value); setErrores((actual) => ({ ...actual, dominio: undefined })); setAviso(null) }}
          error={Boolean(errores.dominio)}
          helperText={errores.dominio ?? (dominio.dominioPendiente && dominio.dominioVigente ? `Pendiente de verificación. Hoy la tienda responde en ${dominio.dominioVigente}.` : undefined)}
          fullWidth
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
        />
        <TextField
          label="Redirigir también"
          value={redireccion}
          onChange={(evento) => { setRedireccion(evento.target.value); setErrores((actual) => ({ ...actual, redireccion: undefined })); setAviso(null) }}
          error={Boolean(errores.redireccion)}
          helperText={errores.redireccion}
          fullWidth
          slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
        />
        <Button variant="contained" disabled={!hayCambios || guardando} onClick={() => void guardar()} sx={{ flexShrink: 0, alignSelf: { md: 'center' } }}>
          {guardando ? 'Guardando…' : 'Guardar dominio'}
        </Button>
      </Stack>

      {conTienda ? (
        <>
          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip
              size="small"
              color={dominio.dominioVerificado ? 'success' : 'warning'}
              label={dominio.dominioVerificado ? 'Dominio verificado' : 'Dominio sin verificar'}
            />
            <Chip size="small" color={CERTIFICADO[dominio.certificado].color} label={CERTIFICADO[dominio.certificado].etiqueta} />
            <Typography variant="caption" color="text.secondary">{textoUltimaVerificacion(dominio.ultimaVerificacion, ahora)}</Typography>
            <Button variant="outlined" size="small" disabled={verificando || hayCambios} onClick={() => void verificar()}>
              Verificar ahora
            </Button>
          </Stack>

          {verificando ? <Alert severity="info" role="alert">Verificando registros DNS…</Alert> : null}

          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label="Registros DNS a cargar">
              <TableHead>
                <TableRow>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Valor</TableCell>
                  <TableCell>Estado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {dominio.registros.map((registro) => (
                  <TableRow key={registro.tipo}>
                    <TableCell>{registro.tipo}</TableCell>
                    <TableCell>{registro.nombre}</TableCell>
                    <TableCell sx={{ wordBreak: 'break-all' }}>{registro.valor}</TableCell>
                    <TableCell>
                      <Chip size="small" color={ESTADO_REGISTRO[registro.estado].color} label={ESTADO_REGISTRO[registro.estado].etiqueta} />
                      {registro.estado === 'incorrecto' && registro.encontrado ? (
                        <Typography variant="caption" color="text.secondary" component="p" sx={{ wordBreak: 'break-all' }}>
                          Encontramos: {registro.encontrado}
                        </Typography>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : null}

      {aviso ? <Alert severity={aviso.severidad} role={aviso.severidad === 'error' ? 'alert' : 'status'}>{aviso.texto}</Alert> : null}
    </Stack>
  )
}

function SeccionDominio({ empresaId, empresaNombre, alCambiarDominio }: PropsPestanaTienda) {
  const { dominio, isLoading, isError, refetch } = useDominioTienda(empresaId)

  return (
    <Card component="section" aria-labelledby="titulo-dominio">
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Typography id="titulo-dominio" variant="h6" component="h2">Dominio</Typography>
          <Typography variant="body2" color="text.secondary">Dónde se ve la tienda de {empresaNombre} y a qué registros debe apuntar.</Typography>
        </Box>
        {isLoading && !dominio ? <EstadoCargaPagina /> : null}
        {isError ? <EstadoError descripcion="No pudimos cargar el dominio de la tienda." reintentar={() => void refetch()} /> : null}
        {dominio ? <Formulario empresaId={empresaId} dominio={dominio} alCambiarDominio={alCambiarDominio} recargar={refetch} /> : null}
      </CardContent>
    </Card>
  )
}

// Con otra empresa activa la sección se monta de cero: no queda ningún dato ni diálogo de la anterior (FR-018).
export default function Dominio(props: PropsPestanaTienda) {
  return <SeccionDominio key={props.empresaId} {...props} />
}
