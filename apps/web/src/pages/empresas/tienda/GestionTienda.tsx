import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
} from '@mui/material'
import { useWarnAboutChange } from '@refinedev/core'
import { useEmpresasAccesibles } from '../../../hooks/useEmpresasAccesibles'
import { useEmpresaActiva } from '../../../hooks/useEmpresaActiva'
import { useEmpresa } from '../../../hooks/useEmpresa'
import { useTiendaDeEmpresa } from '../../../hooks/useTiendaDeEmpresa'
import { useNivelSeccion } from '../../../hooks/useNivelSeccion'
import { useContextoPanel } from '../../../hooks/useContextoPanel'
import { ETIQUETA_ROL } from '../../../lib/permisos'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../../components/pagina/ContenedorSeccion'
import { AccesoRestringido } from '../../acceso-restringido/AccesoRestringido'
import { EncabezadoTienda } from './EncabezadoTienda'
import { cargarPestana, esClavePestanaTienda, type ClavePestanaTienda, type PropsPestanaTienda } from './pestanas'

function ContenidoPestana({ clave, empresaId, empresaNombre }: { clave: ClavePestanaTienda } & PropsPestanaTienda) {
  // El contenido lo aporta cada historia de la épica en `pestanas/<clave>.tsx` (carga
  // diferida). Hasta que exista, la pestaña se muestra vacía con un aviso del kit.
  const Componente = useMemo(() => {
    const cargar = cargarPestana(clave)
    return cargar ? lazy(cargar) : null
  }, [clave])

  if (!Componente) {
    return <EstadoVacio titulo="Esta sección todavía no está disponible." />
  }
  return (
    <Suspense fallback={<EstadoCargaPagina />}>
      <Componente empresaId={empresaId} empresaNombre={empresaNombre} />
    </Suspense>
  )
}

// Gestión de la tienda de una empresa (F-TDA-01, FR-008/FR-009): dentro de Empresas,
// solo con edición en esa sección. Opera siempre sobre la **empresa activa** de la barra
// superior (Principio VIII); «Cambiar a …» cambia esa misma empresa activa y al cambiar
// se reencuadra todo, con aviso si hay cambios sin guardar.
export function GestionTienda() {
  const { id, pestana } = useParams()
  const navigate = useNavigate()
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion('empresas')
  const { contexto } = useContextoPanel()
  const { empresas, empresaActivaId, isLoading: cargandoEmpresas, isError: errorEmpresas, refetch: recargarEmpresas } = useEmpresasAccesibles()
  const { cambiar, cambiando, errorCambio, limpiarError } = useEmpresaActiva()
  const { warnWhen } = useWarnAboutChange()
  const [pendiente, setPendiente] = useState<{ id: string; nombre: string } | null>(null)

  const clave: ClavePestanaTienda = esClavePestanaTienda(pestana) ? pestana : 'identidad'
  const empresaId = empresaActivaId
  const { empresa, isLoading: cargandoEmpresa, isError: errorEmpresa, noEncontrada, refetch: recargarEmpresa } = useEmpresa(empresaId ?? undefined)
  const { tienda, isLoading: cargandoTienda, isError: errorTienda, refetch: recargarTienda } = useTiendaDeEmpresa(empresaId)

  const alineando = useRef(false)

  // Alinea la ruta con la empresa activa (fuente única, FR-009). Si se llega por URL a la
  // tienda de otra empresa accesible, esa pasa a ser la activa; si la activa cambió desde la
  // barra superior, la URL la sigue. Nunca se muestran datos de la empresa anterior.
  useEffect(() => {
    if (!empresaActivaId) return
    if (id === empresaActivaId) {
      alineando.current = false
      return
    }
    const enRuta = id ? empresas.find((otra) => otra.id === id) : undefined
    if (!alineando.current && enRuta) {
      alineando.current = true
      void cambiar(enRuta.id)
      return
    }
    navigate(`/empresas/${empresaActivaId}/tienda/${clave}`, { replace: true })
  }, [empresaActivaId, id, empresas, clave, cambiar, navigate])

  const aplicarCambio = async (destino: { id: string; nombre: string }) => {
    setPendiente(null)
    limpiarError()
    const cambiada = await cambiar(destino.id)
    if (cambiada) {
      navigate(`/empresas/${destino.id}/tienda/${clave}`, { replace: true })
    }
  }

  const pedirCambio = (destino: { id: string; nombre: string }) => {
    if (warnWhen) {
      setPendiente(destino)
      return
    }
    void aplicarCambio(destino)
  }

  if (cargandoNivel) {
    return <Box sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (nivel !== 'edicion') {
    return (
      <AccesoRestringido
        rol={ETIQUETA_ROL[contexto?.rol_efectivo ?? ''] ?? 'actual'}
        seccion="Empresas"
        seccionClave="empresas"
      />
    )
  }
  if (cargandoEmpresas) {
    return <Box sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (errorEmpresas) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoError descripcion="No pudimos cargar tus empresas." reintentar={() => void recargarEmpresas()} />
      </Box>
    )
  }
  if (empresas.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoVacio titulo="No tenés empresas para gestionar." />
      </Box>
    )
  }
  if (!empresaActivaId) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoVacio titulo="Elegí una empresa" descripcion="La tienda se gestiona de a una empresa: elegila en la barra superior." />
      </Box>
    )
  }
  if (id && !empresas.some((otra) => otra.id === id) && id !== empresaActivaId) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoError titulo="No tenés acceso a esta empresa" descripcion="La tienda que buscás no existe o no está entre tus empresas." />
      </Box>
    )
  }
  if (id !== empresaActivaId) {
    return <Box sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (cargandoEmpresa || cargandoTienda) {
    return <Box sx={{ p: 2 }}><EstadoCargaPagina /></Box>
  }
  if (errorEmpresa || errorTienda) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoError
          descripcion="No pudimos cargar la tienda de esta empresa."
          reintentar={() => { void recargarEmpresa(); void recargarTienda() }}
        />
      </Box>
    )
  }
  if (noEncontrada || !empresa) {
    return (
      <Box sx={{ p: 2 }}>
        <EstadoError titulo="Empresa no encontrada" descripcion="No existe o no pertenece a tu organización." />
      </Box>
    )
  }

  const otras = empresas.filter((otra) => otra.id !== empresaId).map((otra) => ({ id: otra.id, nombre: otra.nombre }))

  return (
    <Box>
      <EncabezadoTienda
        empresa={{ id: empresa.id, nombre: empresa.nombre, activa: empresa.activa }}
        dominio={tienda?.dominio ?? null}
        otras={otras}
        pestana={clave}
        cambiando={cambiando}
        onCambiar={pedirCambio}
      />
      <ContenedorSeccion>
        {errorCambio ? <Box sx={{ mb: 2 }}><Alert severity="error" role="alert" onClose={limpiarError}>{errorCambio}</Alert></Box> : null}
        <ContenidoPestana clave={clave} empresaId={empresa.id} empresaNombre={empresa.nombre} />
      </ContenedorSeccion>
      <Dialog
        open={pendiente !== null}
        onClose={() => setPendiente(null)}
        aria-labelledby="cambiar-empresa-tienda-titulo"
      >
        <DialogTitle id="cambiar-empresa-tienda-titulo">¿Cambiar de empresa?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Tenés cambios sin guardar en esta tienda. Si pasás a {pendiente?.nombre}, podés perderlos.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendiente(null)} autoFocus>Seguir acá</Button>
          <Button color="warning" disabled={cambiando} onClick={() => pendiente && void aplicarCambio(pendiente)}>Cambiar igual</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default GestionTienda
