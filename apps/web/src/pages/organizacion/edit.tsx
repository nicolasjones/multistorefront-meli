import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink } from 'react-router'
import { useWarnAboutChange } from '@refinedev/core'
import { Box, Button, Link, List, ListItem, ListItemText, Stack, TextField, Typography } from '@mui/material'
import { useContextoPanel } from '../../hooks/useContextoPanel'
import { useEmpresas } from '../../hooks/useEmpresas'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

const BUCKET_LOGOS = 'logos-organizacion'
const TAMANO_MAXIMO_LOGO = 1024 * 1024
const EXTENSION_POR_TIPO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const ZONA_POR_DEFECTO = 'America/Argentina/Buenos_Aires'

type Organizacion = { id: string; nombre: string; zona_horaria: string; logo_path: string | null }
type Errores = Partial<Record<'nombre' | 'logo', string>>
type Carga = { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'listo'; organizacion: Organizacion }

// Zonas IANA del navegador; la base valida contra pg_timezone_names. La zona
// guardada siempre se incluye para no perderla si el navegador no la lista.
const ZONAS_RESPALDO = [
  'America/Argentina/Buenos_Aires', 'America/Bogota', 'America/Lima', 'America/Mexico_City', 'America/Montevideo',
  'America/Santiago', 'America/Sao_Paulo', 'Europe/Madrid', 'UTC',
]

function zonasHorarias(actual: string): string[] {
  // Intl.supportedValuesOf no existe en navegadores viejos: lista fija de respaldo.
  let delNavegador: string[] = ZONAS_RESPALDO
  try {
    delNavegador = Intl.supportedValuesOf('timeZone')
  } catch {
    // se mantiene el respaldo
  }
  const zonas = new Set<string>(delNavegador)
  zonas.add(ZONA_POR_DEFECTO)
  zonas.add(actual)
  return [...zonas].sort((a, b) => a.localeCompare(b))
}

// Borrado de mejor esfuerzo: un fallo deja un archivo sin referencia (se registra
// para limpieza periódica del bucket, ver docs/administracion-organizacion.md).
async function borrarLogo(ruta: string) {
  try {
    const { error } = await supabaseClient.storage.from(BUCKET_LOGOS).remove([ruta])
    if (error) console.warn('No se pudo borrar el logo sin referencia', ruta, error.message)
  } catch (excepcion) {
    console.warn('No se pudo borrar el logo sin referencia', ruta, excepcion)
  }
}

// Datos y configuración de la organización (F-ORG-03). Solo administrador:
// quien llega por URL directa ve acceso restringido sin consultar nada; la
// escritura la valida la RPC `actualizar_organizacion` (administrador activo
// de SU organización) y el logo vive en un bucket privado por organización.
export function OrganizacionEdit() {
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { contexto, invalidar } = useContextoPanel()
  const organizacionId = contexto?.organizacion_id ?? null
  const habilitado = puedeEscribir === true && organizacionId !== null
  const { empresas, isLoading: cargandoEmpresas, isError: errorEmpresas, refetch: recargarEmpresas } = useEmpresas({ habilitado })
  const { setWarnWhen } = useWarnAboutChange()

  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' })
  const [nombre, setNombre] = useState('')
  const [zona, setZona] = useState(ZONA_POR_DEFECTO)
  const entradaLogo = useRef<HTMLInputElement>(null)
  const [logoPath, setLogoPath] = useState<string | null>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [urlLogo, setUrlLogo] = useState<string | null>(null)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    if (!organizacionId) return
    setCarga({ tipo: 'cargando' })
    const { data, error } = await supabaseClient
      .from('organizaciones')
      .select('id, nombre, zona_horaria, logo_path')
      .eq('id', organizacionId)
      .maybeSingle<Organizacion>()
    if (error || !data) {
      setCarga({ tipo: 'error' })
      return
    }
    setNombre(data.nombre)
    setZona(data.zona_horaria)
    setLogoPath(data.logo_path)
    setArchivo(null)
    setCarga({ tipo: 'listo', organizacion: data })
  }, [organizacionId])

  useEffect(() => {
    if (habilitado) void cargar()
  }, [habilitado, cargar])

  // URL firmada de corta vida para mostrar el logo guardado (bucket privado).
  useEffect(() => {
    let vigente = true
    if (!logoPath) return
    void supabaseClient.storage.from(BUCKET_LOGOS).createSignedUrl(logoPath, 300).then(({ data }) => {
      if (vigente) setUrlLogo(data?.signedUrl ?? null)
    })
    return () => { vigente = false }
  }, [logoPath])

  const guardada = carga.tipo === 'listo' ? carga.organizacion : null
  const sinGuardar = guardada !== null && (nombre.trim() !== guardada.nombre || zona !== guardada.zona_horaria || logoPath !== guardada.logo_path || archivo !== null)
  useEffect(() => {
    setWarnWhen(sinGuardar)
    return () => setWarnWhen(false)
  }, [sinGuardar, setWarnWhen])

  const zonas = useMemo(() => zonasHorarias(guardada?.zona_horaria ?? ZONA_POR_DEFECTO), [guardada?.zona_horaria])

  const encabezado = (
    <EncabezadoPagina titulo="Mi organización" descripcion="Nombre, logo y zona horaria de tu organización." contexto={<ContextoOrganizacionActiva />} />
  )
  const envolver = (contenido: ReactNode) => (
    <Box>
      {encabezado}
      <ContenedorSeccion>{contenido}</ContenedorSeccion>
    </Box>
  )

  if (verificandoPermiso || puedeEscribir === null) return envolver(<EstadoCargaPagina />)
  if (!puedeEscribir) {
    return envolver(<EstadoError titulo="Acceso restringido" descripcion="Solo los administradores pueden editar los datos de la organización." />)
  }
  if (carga.tipo === 'cargando') return envolver(<EstadoCargaPagina />)
  if (carga.tipo === 'error' || !guardada) {
    return envolver(<EstadoError descripcion="No pudimos cargar los datos de la organización." reintentar={() => void cargar()} />)
  }

  const elegirArchivo = (event: ChangeEvent<HTMLInputElement>) => {
    const elegido = event.target.files?.[0] ?? null
    setExito(false)
    if (!elegido) {
      setArchivo(null)
      setErrores((previos) => ({ ...previos, logo: undefined }))
      return
    }
    if (!(elegido.type in EXTENSION_POR_TIPO)) {
      setArchivo(null)
      setErrores((previos) => ({ ...previos, logo: 'El logo debe ser una imagen PNG, JPG o WebP.' }))
      return
    }
    if (elegido.size > TAMANO_MAXIMO_LOGO) {
      setArchivo(null)
      setErrores((previos) => ({ ...previos, logo: 'El logo no puede superar 1 MB.' }))
      return
    }
    setArchivo(elegido)
    setErrores((previos) => ({ ...previos, logo: undefined }))
  }

  const quitarLogo = () => {
    setArchivo(null)
    setLogoPath(null)
    setExito(false)
    setErrores((previos) => ({ ...previos, logo: undefined }))
  }

  const guardar = async (event: FormEvent) => {
    event.preventDefault()
    if (guardando || !organizacionId) return
    setExito(false)
    setErrorGuardado(null)
    const erroresNuevos: Errores = { ...errores }
    erroresNuevos.nombre = nombre.trim() === '' ? 'El nombre de la organización es obligatorio.' : undefined
    setErrores(erroresNuevos)
    if (erroresNuevos.nombre || erroresNuevos.logo) return

    setGuardando(true)
    let rutaNueva: string | null = null
    try {
      let logoFinal = logoPath
      if (archivo) {
        rutaNueva = `${organizacionId}/${crypto.randomUUID()}.${EXTENSION_POR_TIPO[archivo.type]}`
        const { error: errorSubida } = await supabaseClient.storage.from(BUCKET_LOGOS).upload(rutaNueva, archivo, { contentType: archivo.type })
        if (errorSubida) {
          rutaNueva = null
          throw new Error('No pudimos subir el logo. Probá de nuevo.')
        }
        logoFinal = rutaNueva
      }
      const { data, error } = await supabaseClient.rpc('actualizar_organizacion', {
        p_nombre: nombre.trim(),
        p_zona_horaria: zona,
        p_logo_path: logoFinal,
      })
      if (error) throw new Error(error.message || 'No pudimos guardar los cambios.')

      const guardadaAhora = (data as Organizacion | null) ?? { ...guardada, nombre: nombre.trim(), zona_horaria: zona, logo_path: logoFinal }
      // Logo reemplazado o quitado: el archivo anterior ya no se referencia.
      if (guardada.logo_path && guardada.logo_path !== logoFinal) {
        void borrarLogo(guardada.logo_path)
      }
      setNombre(guardadaAhora.nombre)
      setZona(guardadaAhora.zona_horaria)
      setLogoPath(guardadaAhora.logo_path)
      setArchivo(null)
      setCarga({ tipo: 'listo', organizacion: guardadaAhora })
      setExito(true)
      invalidar()
    } catch (excepcion) {
      // El logo subido quedó huérfano si la RPC rechazó los datos.
      if (rutaNueva) void borrarLogo(rutaNueva)
      setErrorGuardado(excepcion instanceof Error ? excepcion.message : 'No pudimos guardar los cambios.')
    } finally {
      setGuardando(false)
    }
  }

  return envolver(
    <Stack spacing={4}>
      <Box component="form" onSubmit={guardar} noValidate sx={{ maxWidth: 560 }}>
        <Stack spacing={2}>
          {exito ? <EstadoExito titulo="Cambios guardados." /> : null}
          {errorGuardado ? <EstadoError titulo="No se guardaron los cambios." descripcion={errorGuardado} /> : null}
          <TextField
            label="Nombre de la organización"
            value={nombre}
            onChange={(event) => { setNombre(event.target.value); setExito(false) }}
            error={Boolean(errores.nombre)}
            helperText={errores.nombre}
            required
            fullWidth
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <TextField
            select
            label="Zona horaria"
            value={zona}
            onChange={(event) => { setZona(event.target.value); setExito(false) }}
            fullWidth
            slotProps={{ select: { native: true } }}
          >
            {zonas.map((valor) => <option key={valor} value={valor}>{valor}</option>)}
          </TextField>
          <Box component="section" aria-labelledby="logo-organizacion-titulo">
            <Typography id="logo-organizacion-titulo" component="h2" variant="subtitle1" sx={{ mb: 1 }}>Logo</Typography>
            {urlLogo && logoPath ? (
              <Box component="img" src={urlLogo} alt="Logo de la organización" sx={{ maxWidth: 160, maxHeight: 160, display: 'block', mb: 1 }} />
            ) : null}
            {!logoPath && !archivo ? <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Todavía no cargaste un logo.</Typography> : null}
            {archivo ? <Typography variant="body2" sx={{ mb: 1 }}>Logo nuevo: {archivo.name}</Typography> : null}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Button variant="outlined" onClick={() => entradaLogo.current?.click()}>
                {logoPath || archivo ? 'Cambiar logo' : 'Subir logo'}
              </Button>
              <input
                ref={entradaLogo}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Archivo del logo"
                tabIndex={-1}
                onChange={elegirArchivo}
                style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
              />
              {logoPath || archivo ? <Button color="inherit" onClick={quitarLogo}>Quitar logo</Button> : null}
            </Stack>
            <Typography variant="caption" color={errores.logo ? 'error' : 'text.secondary'} role={errores.logo ? 'alert' : undefined} sx={{ display: 'block', mt: 0.5 }}>
              {errores.logo ?? 'PNG, JPG o WebP, hasta 1 MB.'}
            </Typography>
          </Box>
          <Box>
            <Button type="submit" variant="contained" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </Box>
        </Stack>
      </Box>

      <Box component="section" aria-labelledby="empresas-organizacion-titulo">
        <Typography id="empresas-organizacion-titulo" component="h2" variant="h6" sx={{ mb: 1 }}>Empresas de la organización</Typography>
        {cargandoEmpresas ? (
          <EstadoCargaPagina lineas={2} />
        ) : errorEmpresas ? (
          <EstadoError descripcion="No pudimos cargar las empresas." reintentar={() => void recargarEmpresas()} />
        ) : empresas.length === 0 ? (
          <EstadoVacio titulo="Todavía no hay empresas cargadas." />
        ) : (
          <List dense disablePadding aria-label="Empresas de la organización">
            {empresas.map((empresa) => (
              <ListItem key={empresa.id} disableGutters>
                <ListItemText
                  primary={empresa.nombre}
                  secondary={empresa.activa ? 'Activa' : 'Pausada'}
                />
                <Link component={RouterLink} to={`/empresas/edit/${empresa.id}`} aria-label={`Editar ${empresa.nombre}`}>Editar</Link>
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Stack>,
  )
}
