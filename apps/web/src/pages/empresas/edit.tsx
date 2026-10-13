import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { useWarnAboutChange } from '@refinedev/core'
import { Box, Button, Stack, TextField } from '@mui/material'
import { useEmpresa, type DatosGeneralesEmpresa } from '../../hooks/useEmpresa'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { calcularCambios, emitirEventoActividad } from '../../lib/eventosActividad'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'

type Formulario = { nombre: string; whatsapp: string; correo: string; instagram: string; direccion: string }
type Errores = Partial<Record<'nombre' | 'correo', string>>

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const aFormulario = (datos: DatosGeneralesEmpresa): Formulario => ({
  nombre: datos.nombre,
  whatsapp: datos.whatsapp ?? '',
  correo: datos.correo ?? '',
  instagram: datos.instagram ?? '',
  direccion: datos.direccion ?? '',
})

// Los opcionales vacíos se guardan como null, no como cadena vacía.
const aDatos = (formulario: Formulario): DatosGeneralesEmpresa => {
  const opcional = (valor: string) => (valor.trim() === '' ? null : valor.trim())
  return {
    nombre: formulario.nombre.trim(),
    whatsapp: opcional(formulario.whatsapp),
    correo: opcional(formulario.correo),
    instagram: opcional(formulario.instagram),
    direccion: opcional(formulario.direccion),
  }
}

function validar(formulario: Formulario): Errores {
  const errores: Errores = {}
  if (formulario.nombre.trim() === '') errores.nombre = 'El nombre comercial es obligatorio.'
  const correo = formulario.correo.trim()
  if (correo !== '' && !CORREO_VALIDO.test(correo)) errores.correo = 'Ingresá un correo con formato válido.'
  return errores
}

// General de la empresa (F-EMP-02). Solo administrador: para quien llega por
// URL directa se muestra solo lectura; RLS (empresas_update ->
// puede_escribir) rechaza igual cualquier guardado. Idioma y moneda son
// constantes del producto; el dominio se administra desde Tiendas online.
export function EmpresaEdit() {
  const { id } = useParams()
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { empresa, isLoading, isError, noEncontrada, refetch, actualizar } = useEmpresa(id)
  const { setWarnWhen } = useWarnAboutChange()

  const [formulario, setFormulario] = useState<Formulario | null>(null)
  const [sincronizadoDe, setSincronizadoDe] = useState<string | undefined>(undefined)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)

  // Una vez por empresa cargada (ajuste de estado durante el render).
  if (empresa && sincronizadoDe !== empresa.id) {
    setFormulario(aFormulario(empresa))
    setSincronizadoDe(empresa.id)
  }

  const sinGuardar = empresa !== null && formulario !== null && JSON.stringify(aDatos(formulario)) !== JSON.stringify(aDatosGuardados(empresa))
  useEffect(() => {
    setWarnWhen(sinGuardar)
    return () => setWarnWhen(false)
  }, [sinGuardar, setWarnWhen])

  const encabezado = (
    <EncabezadoPagina
      titulo={empresa?.nombre ?? 'Empresa'}
      contexto={<ContextoOrganizacionActiva />}
      accion={<Button component={RouterLink} to="/empresas">Volver al listado</Button>}
    />
  )
  const envolver = (contenido: ReactNode) => (
    <Box>
      {encabezado}
      <ContenedorSeccion>{contenido}</ContenedorSeccion>
    </Box>
  )

  if (verificandoPermiso || puedeEscribir === null || isLoading) return envolver(<EstadoCargaPagina />)
  if (isError) return envolver(<EstadoError descripcion="No pudimos cargar la empresa." reintentar={() => void refetch()} />)
  if (noEncontrada || !empresa || !formulario) {
    return envolver(<EstadoError titulo="Empresa no encontrada" descripcion="No existe o no pertenece a tu organización." />)
  }

  const soloLectura = !puedeEscribir
  const cambiar = (campo: keyof Formulario) => (event: ChangeEvent<HTMLInputElement>) => {
    setFormulario({ ...formulario, [campo]: event.target.value })
    setExito(false)
  }

  const guardar = async (event: FormEvent) => {
    event.preventDefault()
    setExito(false)
    setErrorGuardado(null)
    const erroresNuevos = validar(formulario)
    setErrores(erroresNuevos)
    if (Object.keys(erroresNuevos).length > 0) return

    const antes = aDatosGuardados(empresa)
    const despues = aDatos(formulario)
    setGuardando(true)
    try {
      const guardada = await actualizar(despues)
      setFormulario(aFormulario(guardada))
      setExito(true)
    } catch (excepcion) {
      setErrorGuardado(excepcion instanceof Error ? excepcion.message : 'No pudimos guardar los cambios.')
      setGuardando(false)
      return
    }
    setGuardando(false)
    // La actividad es secundaria al guardado ya persistido (FR-010): ningún
    // fallo al obtener el actor o emitir el evento debe mostrarse como error.
    try {
      const { data } = await supabaseClient.auth.getUser()
      void emitirEventoActividad({
        tipo: 'empresa.actualizada',
        actorId: data.user?.id ?? null,
        empresaId: empresa.id,
        cambios: calcularCambios(antes, despues),
        fecha: new Date().toISOString(),
      })
    } catch (excepcion) {
      console.warn('No se pudo registrar la actividad de la empresa', excepcion)
    }
  }

  return envolver(
    <Box component="form" onSubmit={guardar} noValidate sx={{ maxWidth: 560 }}>
      <Stack spacing={2}>
        {soloLectura ? <EstadoError titulo="Solo lectura" descripcion="Solo los administradores pueden editar los datos de la empresa." /> : null}
        {exito ? <EstadoExito titulo="Cambios guardados." /> : null}
        {errorGuardado ? <EstadoError titulo="No se guardaron los cambios." descripcion={errorGuardado} /> : null}
        <TextField
          label="Nombre comercial"
          value={formulario.nombre}
          onChange={cambiar('nombre')}
          error={Boolean(errores.nombre)}
          helperText={errores.nombre}
          required
          disabled={soloLectura}
          fullWidth
        />
        <TextField label="Dominio" value="Sin configurar" helperText="Se administra desde «Dominio y publicación»." disabled fullWidth />
        <TextField label="Idioma" value="Español (Argentina)" disabled fullWidth />
        <TextField label="Moneda" value="ARS · Peso argentino" disabled fullWidth />
        <TextField label="WhatsApp" value={formulario.whatsapp} onChange={cambiar('whatsapp')} disabled={soloLectura} fullWidth />
        <TextField
          label="Correo"
          type="email"
          value={formulario.correo}
          onChange={cambiar('correo')}
          error={Boolean(errores.correo)}
          helperText={errores.correo}
          disabled={soloLectura}
          fullWidth
        />
        <TextField label="Instagram" value={formulario.instagram} onChange={cambiar('instagram')} disabled={soloLectura} fullWidth />
        <TextField label="Dirección (opcional)" value={formulario.direccion} onChange={cambiar('direccion')} disabled={soloLectura} fullWidth />
        {soloLectura ? null : (
          <Button type="submit" variant="contained" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        )}
      </Stack>
    </Box>,
  )
}

function aDatosGuardados(empresa: DatosGeneralesEmpresa): DatosGeneralesEmpresa {
  return aDatos(aFormulario(empresa))
}
