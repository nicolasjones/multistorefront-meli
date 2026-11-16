import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIsSuperadmin } from '../hooks/useIsSuperadmin'
import { useOrganizacionDeTrabajo } from '../hooks/useOrganizacionDeTrabajo'
import { useNivelSeccion } from '../hooks/useNivelSeccion'
import { etiquetaDeRol, resolverRolId } from '../lib/rolActual'
import { EstadoCargaPagina, EstadoError } from './estados/EstadosPagina'
import { DESTINOS_PANEL } from './navegacion/destinosPanel'
import { AccesoRestringido } from '../pages/acceso-restringido/AccesoRestringido'
import { BorradorConservadoContext } from '../context/BorradorConservado'
import { AvisoPermisosSinConfirmar } from './permisos/AvisoPermisosSinConfirmar'
import { ZonaInerte } from './permisos/ZonaInerte'
import { SOLO_LECTORES } from './base/solo-lectores'

function etiquetaSeccion(seccion: string): string {
  return DESTINOS_PANEL.find((destino) => destino.seccionPermiso === seccion)?.etiqueta ?? seccion
}

// F-ROL-03 (FR-008): quien llega por URL a una sección sin acceso ve
// AccesoRestringido en lugar de la sección. Los hijos no se montan, así que no
// se carga ningún dato de la sección (US2 criterio 4). Es defensa de UX: la
// autorización real es RLS. El superadmin sigue su camino (opera como
// administrador) y mientras carga se muestra el estado de carga compartido (deny-by-default).
//
// MSF-855: si con la sección ya abierta falla el repedido de permisos de la MISMA clave `usuario:organización`, los
// hijos siguen montados (el borrador no se pierde) pero inertes y con un aviso «Reintentar»; no se puede editar ni
// guardar hasta confirmar el nivel (falla cerrada: la zona queda bloqueada, y el servidor sigue siendo la autoridad).
// Si la clave cambia (otro usuario u otra organización) los hijos se desmontan como siempre y el borrador se descarta:
// nunca se muestra el de la clave anterior. Un fallo con la sección que aún no se había abierto sigue siendo el aviso
// que desmonta.
//
// `nivelMinimo` es el nivel de la sección que hace falta para entrar: 'lectura' (el default) abre con lectura o
// edición; 'edicion' deja pasar solo a quien puede escribir en la sección (pantallas que venden o editan).
export function RequiereAccesoSeccion({
  seccion,
  nivelMinimo = 'lectura',
  children,
}: {
  seccion: string
  nivelMinimo?: 'lectura' | 'edicion'
  children: ReactNode
}) {
  const { isSuperadmin, isLoading: cargandoSuperadmin } = useIsSuperadmin()
  const { nivel, isLoading: cargandoNivel, error: errorPermisos, recargar, clave, sinConfirmar } = useNivelSeccion(seccion)
  const { organizacionId, isLoading: cargandoOrganizacion } = useOrganizacionDeTrabajo()
  const cargando = cargandoSuperadmin || cargandoNivel || cargandoOrganizacion
  // Falla cerrada: solo lectura/edicion abren la sección; un nivel nulo tras
  // cargar (error al resolver permisos) también se trata como denegado.
  const cumple = nivelMinimo === 'edicion' ? nivel === 'edicion' : nivel === 'lectura' || nivel === 'edicion'
  const denegado = !cargando && !errorPermisos && !cumple && isSuperadmin === false
  const [rol, setRol] = useState<string | null>(null)
  // Clave con la que esta sección estuvo abierta con el nivel confirmado (null: no está abierta). Solo si el fallo
  // llega con ESA misma clave se conserva el borrador.
  const [claveAbierta, setClaveAbierta] = useState<string | null>(null)
  const conservaBorrador = isSuperadmin === false && errorPermisos && typeof clave === 'string' && claveAbierta === clave
  const abiertaNormal = !conservaBorrador && !(errorPermisos && isSuperadmin === false) && !cargando && !denegado
  const claveDeAbierta = abiertaNormal ? (clave ?? null) : null
  const valorConservado = useMemo(() => (conservaBorrador && typeof clave === 'string' ? { clave } : null), [conservaBorrador, clave])

  // Ajuste de estado durante el render (sin efecto): al conservar el borrador se mantiene la clave; en cualquier otro
  // caso refleja si la sección está abierta ahora (null si no lo está).
  const claveSiguiente = conservaBorrador ? claveAbierta : claveDeAbierta
  if (claveSiguiente !== claveAbierta) {
    setClaveAbierta(claveSiguiente)
  }

  // Accesibilidad: si la persona estaba en «Reintentar» y el aviso desaparece (se confirmó el acceso) el foco se
  // perdería en <body>. Se lleva a la región viva (tabIndex -1), que anuncia que el acceso se confirmó.
  const regionViva = useRef<HTMLDivElement>(null)
  const focoEnAviso = useRef(false)
  const [huboAviso, setHuboAviso] = useState(false)
  // Ajuste durante el render: «hubo aviso» mientras se conserva el borrador; se olvida si la sección deja de estar abierta.
  if (conservaBorrador && !huboAviso) setHuboAviso(true)
  if (!conservaBorrador && huboAviso && claveSiguiente === null) setHuboAviso(false)
  const accesoConfirmado = huboAviso && !conservaBorrador
  useLayoutEffect(() => {
    if (accesoConfirmado && focoEnAviso.current && (document.activeElement === document.body || document.activeElement === null)) {
      regionViva.current?.focus()
    }
    if (!conservaBorrador) focoEnAviso.current = false
  }, [accesoConfirmado, conservaBorrador])

  useEffect(() => {
    if (!denegado) {
      return
    }
    let cancelada = false
    // Si la consulta falla, se muestra la pantalla con un rol genérico: el
    // rol solo ilustra el mensaje y nunca debe dejar la pantalla en blanco.
    resolverRolId(organizacionId)
      .catch(() => '')
      .then((valor) => { if (!cancelada) setRol(valor) })
    return () => { cancelada = true }
  }, [denegado, organizacionId])

  if (sinConfirmar && cumple) {
    // Dentro de una zona que ya conserva su borrador (otra RequiereAccesoSeccion anidada): la zona exterior bloquea y avisa.
    // Solo si el último nivel confirmado de ESTA sección cumple el mínimo: una sección anidada que no estaba abierta
    // (sin nivel suficiente) sigue denegada, no se abre por el simple hecho de que la exterior conserva su borrador.
    return <>{children}</>
  }
  if (!conservaBorrador && !cargando && errorPermisos && isSuperadmin === false) {
    // No se pudo verificar: la sección sigue sin montarse (falla cerrada), pero no se culpa al rol.
    return <EstadoError titulo="No pudimos verificar tus permisos." descripcion="Reintentá en unos segundos." reintentar={recargar} />
  }
  if (!conservaBorrador && (cargando || (denegado && rol === null))) {
    return <EstadoCargaPagina />
  }
  if (!denegado || conservaBorrador) {
    // Misma estructura con o sin bloqueo: los hijos no se remontan al pasar a inertes. La región viva existe antes
    // del aviso para que los lectores de pantalla lo anuncien sin mover el foco. `key` por clave: otra clave remonta.
    return (
      <>
        <div
          ref={regionViva}
          tabIndex={-1}
          aria-live="polite"
          aria-atomic="true"
          onFocusCapture={() => { focoEnAviso.current = true }}
          onBlurCapture={(evento) => { if (evento.relatedTarget) focoEnAviso.current = false }}
          style={{ outline: 'none' }}
        >
          {conservaBorrador ? <AvisoPermisosSinConfirmar reintentar={recargar} verificando={cargandoNivel} /> : null}
          {!conservaBorrador && accesoConfirmado ? <span style={SOLO_LECTORES}>Acceso confirmado. Ya podés editar.</span> : null}
        </div>
        <BorradorConservadoContext.Provider value={valorConservado}>
          <ZonaInerte key={typeof clave === 'string' ? clave : 'sin-clave'} bloqueada={conservaBorrador}>{children}</ZonaInerte>
        </BorradorConservadoContext.Provider>
      </>
    )
  }
  // Con edición exigida, el mensaje dice que falta ese nivel y no que la sección no existe para el rol.
  const etiqueta = nivelMinimo === 'edicion' ? `${etiquetaSeccion(seccion)} (edición)` : etiquetaSeccion(seccion)
  return <AccesoRestringido rol={etiquetaDeRol(rol ?? '')} seccion={etiqueta} seccionClave={seccion} />
}
