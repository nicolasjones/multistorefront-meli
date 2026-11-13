import { Box, Button, Dialog, InputBase, Typography } from '@mui/material'
import { useEffect, useRef } from 'react'
import { registrarEventoTienda } from '../../../lib/analiticaTienda'
import { nuevaClaveEnvioWhatsapp, registrarConsultaWhatsapp } from '../../../lib/registroWhatsapp'
import { textoSobre } from '../../../tema/temaTienda'
import { IconoWhatsapp } from './IconoWhatsapp'

// Verde de WhatsApp del prototipo (marca de terceros, no de la identidad de la tienda).
const COLOR_WHATSAPP = '#25D366' // estilos-sueltos: ok

export type PropsDialogoWhatsApp = {
  // Si el diálogo está abierto.
  abierto: boolean
  // Host de la tienda (de acá sale la empresa en la base).
  host: string
  // Producto que se registra en la bandeja.
  productoId: string
  // Empresa y número que se muestran.
  empresa: string
  numero: string
  // Mensaje armado que se muestra y se envía.
  mensaje: string
  // Enlace `wa.me` ya codificado.
  url: string
  // Cierra el diálogo sin efectos.
  onCerrar: () => void
  // Avisa que WhatsApp quedó abierto con el mensaje listo.
  onAviso: () => void
}

// Diálogo «Consultar por WhatsApp» (F-TDA-14, FR-021, FR-023, FR-024, FR-026). Muestra el mensaje que se
// va a enviar (solo lectura), se cierra con «Cancelar», Esc o clic fuera y, con «Abrir WhatsApp», abre
// `wa.me` en una pestaña nueva con `noopener`, registra el interés y avisa que quedó listo.
export default function DialogoWhatsApp({
  abierto,
  host,
  productoId,
  empresa,
  numero,
  mensaje,
  url,
  onCerrar,
  onAviso,
}: PropsDialogoWhatsApp) {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  // Una `clave_envio` por apertura del diálogo (FR-024, FR-004): dos aperturas distintas registran dos
  // consultas; un doble clic sobre «Abrir WhatsApp» no puede registrar la misma apertura dos veces.
  const clave = useRef('')
  const registrando = useRef(false)

  useEffect(() => {
    if (!abierto) return
    clave.current = nuevaClaveEnvioWhatsapp()
    registrando.current = false
  }, [abierto])

  const abrir = () => {
    if (registrando.current) return
    registrando.current = true
    // WhatsApp se abre primero y no espera al registro: la acción del visitante no se frena (FR-024).
    window.open(url, '_blank', 'noopener')
    // El registro no bloquea la apertura ni muestra fallas o límite al visitante (FR-024, D3).
    void registrarConsultaWhatsapp(host, productoId, clave.current)
    // Evento de medición (F-TDA-24, FR-016): solo el nombre, sin datos del visitante; sin medición cargada es un no-op.
    registrarEventoTienda('clic_whatsapp')
    onCerrar()
    onAviso()
  }

  return (
    <Dialog
      open={abierto}
      onClose={onCerrar}
      fullWidth
      maxWidth={false}
      aria-labelledby="titulo-whatsapp"
      aria-describedby="linea-whatsapp"
      // Foco inicial dentro del diálogo: el título, que es su nombre accesible (FR-026). Se lo
      // enfoca al terminar la apertura porque el contenido del diálogo se monta después (portal).
      // `slotProps.transition` es la API vigente de MUI v6: `TransitionProps` está deprecada (se
      // avisa por consola y se quita en v7). Es la misma que usa el selector de empresa del panel.
      slotProps={{
        transition: { onEntered: () => titulo.current?.focus() },
        // Prototipo (`MJC_Producto`, `.modal`): 460 px, radio 14, sombra `0 24 60 .35` y 28 px de relleno.
        paper: { sx: { width: 460, maxWidth: 'calc(100% - 32px)', m: 0, p: { xs: '20px', md: '28px' }, borderRadius: '14px', boxShadow: '0 24px 60px rgba(0,0,0,.35)' } }, // estilos-sueltos: ok
        backdrop: { sx: { bgcolor: 'rgba(0,0,0,.45)' /* estilos-sueltos: ok */ } },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Círculo verde de WhatsApp (verde de WhatsApp del prototipo) con el glifo en blanco: es decorativo (el título nombra la acción). */}
        <Box component="span" aria-hidden sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: COLOR_WHATSAPP, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 /* estilos-sueltos: ok */ }}>
          <IconoWhatsapp size={24} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography id="titulo-whatsapp" component="h2" variant="h6" tabIndex={-1} ref={titulo} sx={{ fontSize: 20, outline: 'none' /* estilos-sueltos: ok */ }}>
            Consultar por WhatsApp
          </Typography>
          <Typography id="linea-whatsapp" color="text.secondary" sx={{ fontSize: 13, overflowWrap: 'anywhere' /* estilos-sueltos: ok */ }}>
            {empresa} · {numero}
          </Typography>
        </Box>
      </Box>
      {/* Recuadro gris con el mensaje (solo lectura): `textarea` de solo lectura con su rótulo, para que se lea y se copie. */}
      <Typography component="label" htmlFor="mensaje-whatsapp" color="text.secondary" sx={{ display: 'block', fontSize: 13, m: '20px 0 6px' /* estilos-sueltos: ok */ }}>
        Mensaje que se va a enviar
      </Typography>
      <InputBase
        id="mensaje-whatsapp"
        value={mensaje}
        multiline
        fullWidth
        readOnly
        sx={(tema) => ({ bgcolor: tema.tienda?.superficie ?? 'action.hover', borderRadius: '10px', p: '14px', fontSize: 15, lineHeight: 1.5, alignItems: 'flex-start' /* estilos-sueltos: ok */ })}
      />
      <Box sx={{ display: 'flex', gap: '10px', mt: '20px' }}>
        <Button
          onClick={onCerrar}
          sx={{ flex: 1, height: 44, border: '2px solid rgba(0,0,0,.15)', borderRadius: '8px', bgcolor: 'background.paper', color: 'text.primary', fontSize: 16, '&:hover': { bgcolor: 'background.paper', borderColor: 'rgba(0,0,0,.3)' } /* estilos-sueltos: ok */ }}
        >
          Cancelar
        </Button>
        {/* El texto va en la tinta de la tienda (no en blanco como en el prototipo): blanco sobre ese verde queda en 2:1 y no cumple AA. */}
        <Button
          onClick={abrir}
          sx={(tema) => ({ flex: 1, height: 44, bgcolor: COLOR_WHATSAPP, color: textoSobre(COLOR_WHATSAPP, [tema.palette.text.primary, '#000000']), fontSize: 16, '&:hover': { bgcolor: COLOR_WHATSAPP, opacity: 0.9 }, '&:focus-visible': { outline: '3px solid', outlineColor: 'text.primary', outlineOffset: '2px' } /* estilos-sueltos: ok */ })}
        >
          Abrir WhatsApp
        </Button>
      </Box>
    </Dialog>
  )
}
