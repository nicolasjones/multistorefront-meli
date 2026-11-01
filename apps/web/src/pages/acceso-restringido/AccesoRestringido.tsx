import { Button, Stack } from '@mui/material'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { solicitarAcceso } from '../../lib/solicitarAcceso'

type AccesoRestringidoProps = {
  // Nombre visible del rol y de la sección (no identificadores técnicos).
  rol?: string
  seccion: string
  // Clave de la sección en el catálogo de permisos. Sin ella no se ofrece «Solicitar acceso».
  seccionClave?: string
}

type Estado =
  | { fase: 'inicial' }
  | { fase: 'enviando' }
  | { fase: 'enviada'; sinAdministradores: boolean }
  | { fase: 'error'; mensaje: string }

// F-ROL-03 (FR-008): se muestra en lugar de la sección denegada. No carga datos de la sección.
// F-ROL-05 (FR-005, FR-006, FR-010): «Solicitar acceso» registra el pedido del día y avisa al
// administrador; la confirmación y el error se anuncian a lectores de pantalla (role alert del Alert).
export function AccesoRestringido({ rol, seccion, seccionClave }: AccesoRestringidoProps) {
  const [estado, setEstado] = useState<Estado>({ fase: 'inicial' })
  // Guarda síncrona contra el doble clic: el estado de React tarda un render en deshabilitar el botón.
  const enCurso = useRef(false)

  const solicitar = async () => {
    if (!seccionClave || enCurso.current) return
    enCurso.current = true
    setEstado({ fase: 'enviando' })
    try {
      const resultado = await solicitarAcceso(seccionClave)
      setEstado(resultado.ok ? { fase: 'enviada', sinAdministradores: resultado.sinAdministradores } : { fase: 'error', mensaje: resultado.mensaje })
    } catch (error) {
      console.error('No se pudo solicitar acceso', error)
      setEstado({ fase: 'error', mensaje: 'No pudimos enviar tu solicitud. Intentá de nuevo.' })
    } finally {
      enCurso.current = false
    }
  }

  const enviada = estado.fase === 'enviada'
  // «actual» es el valor de relleno de quien no conoce el nombre del rol: no se muestra como si fuera uno.
  const rolConocido = Boolean(rol) && rol !== 'actual'
  return (
    <>
      <EncabezadoPagina titulo="No tenés acceso a esta sección" />
      <ContenedorSeccion>
        <Stack spacing={2}>
          <EstadoVacio
            titulo="Sección no disponible para tu rol"
            descripcion={`${rolConocido ? `Tu rol (${rol})` : 'Tu rol'} no incluye ${seccion}. Pedile acceso a un administrador.`}
            accion={(
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {seccionClave ? (
                  <Button color="inherit" disabled={estado.fase === 'enviando' || enviada} onClick={solicitar}>
                    {estado.fase === 'enviando' ? 'Enviando…' : 'Solicitar acceso'}
                  </Button>
                ) : null}
                <Button color="inherit" component={Link} to="/">Volver al inicio</Button>
              </Stack>
            )}
          />
          {estado.fase === 'enviada' ? (
            <EstadoExito
              titulo="Solicitud enviada al administrador"
              descripcion={estado.sinAdministradores ? 'Tu pedido quedó registrado, pero tu organización no tiene un administrador activo a quien avisar.' : undefined}
            />
          ) : null}
          {estado.fase === 'error' ? <EstadoError titulo="No pudimos enviar tu solicitud." descripcion={estado.mensaje} reintentar={solicitar} /> : null}
        </Stack>
      </ContenedorSeccion>
    </>
  )
}
