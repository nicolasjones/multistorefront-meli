import { type ChangeEvent, type FormEvent, type ReactNode, useEffect, useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router'
import { useWarnAboutChange } from '@refinedev/core'
import { Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEmpresa, type DatosGeneralesEmpresa } from '../../hooks/useEmpresa'
import { usePuedeEscribir } from '../../hooks/usePuedeEscribir'
import { supabaseClient } from '../../lib/supabase'
import { calcularCambios, emitirEventoActividad, type EventoActividad } from '../../lib/eventosActividad'
import { EstadoCargaPagina, EstadoError, EstadoExito } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EtiquetaEstado } from '../../components/base/EtiquetaEstado'
import { PestanasEmpresa } from './PestanasEmpresa'
import { CorreoAvisosConsultas } from './CorreoAvisosConsultas'

type Formulario = { nombre: string; whatsapp: string; correo: string; instagram: string; direccion: string; horarios: string }
type Errores = Partial<Record<'nombre' | 'correo' | 'horarios', string>>

// Tope de «Horarios de atención» (F-TDA-16, FR-014): el mismo que el check de dominio.empresas.horarios.
const MAX_HORARIOS = 200

const CORREO_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const aFormulario = (datos: DatosGeneralesEmpresa): Formulario => ({
  nombre: datos.nombre,
  whatsapp: datos.whatsapp ?? '',
  correo: datos.correo ?? '',
  instagram: datos.instagram ?? '',
  direccion: datos.direccion ?? '',
  horarios: datos.horarios ?? '',
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
    horarios: opcional(formulario.horarios),
  }
}

function validar(formulario: Formulario): Errores {
  const errores: Errores = {}
  if (formulario.nombre.trim() === '') errores.nombre = 'El nombre comercial es obligatorio.'
  const correo = formulario.correo.trim()
  if (correo !== '' && !CORREO_VALIDO.test(correo)) errores.correo = 'Ingresá un correo con formato válido.'
  if (formulario.horarios.trim().length > MAX_HORARIOS) errores.horarios = `Los horarios admiten hasta ${MAX_HORARIOS} caracteres.`
  return errores
}

// General de la empresa (F-EMP-02). Solo administrador: para quien llega por
// URL directa se muestra solo lectura; RLS (empresas_update ->
// puede_escribir) rechaza igual cualquier guardado. Idioma y moneda son
// constantes del producto; el dominio se administra desde Tiendas online.
export function EmpresaEdit() {
  const { id } = useParams()
  const { puedeEscribir, isLoading: verificandoPermiso } = usePuedeEscribir()
  const { empresa, isLoading, isError, noEncontrada, refetch, actualizar, cambiarEstado, esVigente } = useEmpresa(id)
  const { setWarnWhen } = useWarnAboutChange()

  const [formulario, setFormulario] = useState<Formulario | null>(null)
  const [sincronizadoDe, setSincronizadoDe] = useState<string | undefined>(undefined)
  const [errores, setErrores] = useState<Errores>({})
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState(false)
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null)
  const [cambiandoEstado, setCambiandoEstado] = useState(false)
  const [errorEstado, setErrorEstado] = useState<string | null>(null)

  // Una vez por empresa cargada (ajuste de estado durante el render).
  if (empresa && sincronizadoDe !== empresa.id) {
    setFormulario(aFormulario(empresa))
    setSincronizadoDe(empresa.id)
    // El estado de las acciones de la empresa anterior no se arrastra a otra.
    setErrores({})
    setExito(false)
    setErrorGuardado(null)
    setGuardando(false)
    setErrorEstado(null)
    setCambiandoEstado(false)
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
      pestanas={id ? <PestanasEmpresa empresaId={id} activa="general" /> : undefined}
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
    if (cambiandoEstado) return
    setExito(false)
    setErrorGuardado(null)
    const erroresNuevos = validar(formulario)
    setErrores(erroresNuevos)
    if (Object.keys(erroresNuevos).length > 0) return

    const empresaId = empresa.id
    const antes = aDatosGuardados(empresa)
    const despues = aDatos(formulario)
    setGuardando(true)
    try {
      const guardada = await actualizar(despues)
      if (esVigente(empresaId)) {
        setFormulario(aFormulario(guardada))
        setExito(true)
      }
    } catch (excepcion) {
      if (!esVigente(empresaId)) {
        console.warn('No se pudo guardar la empresa anterior', excepcion)
        return
      }
      setErrorGuardado(excepcion instanceof Error ? excepcion.message : 'No pudimos guardar los cambios.')
      setGuardando(false)
      return
    }
    if (esVigente(empresaId)) setGuardando(false)
    await registrarActividad({ tipo: 'empresa.actualizada', empresaId, cambios: calcularCambios(antes, despues) })
  }

  // Pausar o reactivar la tienda es una acción inmediata, independiente del
  // formulario: no guarda ni descarta los cambios pendientes de los datos.
  const alternarEstado = async () => {
    if (guardando) return
    const activa = !empresa.activa
    const empresaId = empresa.id
    setErrorEstado(null)
    setCambiandoEstado(true)
    try {
      await cambiarEstado(activa)
    } catch (excepcion) {
      if (!esVigente(empresaId)) {
        console.warn('No se pudo cambiar el estado de la empresa anterior', excepcion)
        return
      }
      setErrorEstado(excepcion instanceof Error ? excepcion.message : 'No pudimos cambiar el estado de la tienda.')
      setCambiandoEstado(false)
      return
    }
    if (esVigente(empresaId)) setCambiandoEstado(false)
    await registrarActividad({
      tipo: activa ? 'empresa.reactivada' : 'empresa.pausada',
      empresaId,
      cambios: [{ campo: 'activa', antes: String(!activa), despues: String(activa) }],
    })
  }

  return envolver(
    <>
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
          <Box component="section" aria-labelledby="estado-tienda-titulo">
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography id="estado-tienda-titulo" component="h2" variant="subtitle1">Estado de la tienda</Typography>
              <Box role="status">
                <EtiquetaEstado texto={empresa.activa ? 'Activa' : 'Pausada'} variante={empresa.activa ? 'exito' : 'aviso'} />
              </Box>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Si la desactivás, el dominio muestra un aviso de “Volvemos pronto”.
            </Typography>
            {errorEstado ? <EstadoError titulo="No se cambió el estado." descripcion={errorEstado} reintentar={() => void alternarEstado()} /> : null}
            {soloLectura ? null : (
              <Button variant="outlined" color={empresa.activa ? 'warning' : 'primary'} onClick={() => void alternarEstado()} disabled={cambiandoEstado || guardando}>
                {cambiandoEstado ? 'Cambiando estado…' : empresa.activa ? 'Pausar tienda' : 'Reactivar tienda'}
              </Button>
            )}
          </Box>
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
          <TextField
            label="Horarios de atención"
            placeholder="Lunes a viernes de 10 a 19 h"
            helperText={errores.horarios ?? 'Se muestran en la página de Contacto de la tienda.'}
            error={Boolean(errores.horarios)}
            value={formulario.horarios}
            onChange={cambiar('horarios')}
            disabled={soloLectura}
            fullWidth
          />
          {soloLectura ? null : (
            <Button type="submit" variant="contained" disabled={guardando || cambiandoEstado}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          )}
        </Stack>
      </Box>
      <Box sx={{ maxWidth: 560, mt: 4 }}>
        <CorreoAvisosConsultas
          key={empresa.id}
          empresaId={empresa.id}
          correoContacto={empresa.correo}
          soloLectura={soloLectura}
        />
      </Box>
    </>,
  )
}

function aDatosGuardados(empresa: DatosGeneralesEmpresa): DatosGeneralesEmpresa {
  return aDatos(aFormulario(empresa))
}

// La actividad es secundaria a lo ya persistido (FR-010): ningún fallo al
// obtener el actor o emitir el evento debe mostrarse como error.
async function registrarActividad(evento: Omit<EventoActividad, 'actorId' | 'fecha'>) {
  try {
    const { data } = await supabaseClient.auth.getUser()
    void emitirEventoActividad({ ...evento, actorId: data.user?.id ?? null, fecha: new Date().toISOString() })
  } catch (excepcion) {
    console.warn('No se pudo registrar la actividad de la empresa', excepcion)
  }
}
