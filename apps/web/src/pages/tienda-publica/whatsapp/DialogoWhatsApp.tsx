import { Box, Button, Dialog, InputBase, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { registrarEventoTienda } from '../../../lib/analiticaTienda'
import { nuevaClaveEnvioWhatsapp, registrarConsultaWhatsapp } from '../../../lib/registroWhatsapp'
import { SOLO_LECTORES } from '../../../components/base/solo-lectores'
import { textoSobre } from '../../../tema/temaTienda'
import { IconoWhatsapp } from './IconoWhatsapp'

// Parte el mensaje en [antes, producto (negrita), después]. El producto va tras «consultar por » (ver `armarMensaje`): se busca esa aparición y
// no la primera, porque el nombre de la empresa (que va antes) podría contener el del producto; sin ese tramo, la última aparición.
function partesMensaje(mensaje: string, producto?: string): Array<{ texto: string; negrita: boolean }> {
  const nombre = producto?.trim()
  const marca = nombre ? mensaje.indexOf(`consultar por ${nombre}`) : -1
  const i = !nombre ? -1 : marca >= 0 ? marca + 'consultar por '.length : mensaje.lastIndexOf(nombre)
  if (!nombre || i < 0) return [{ texto: mensaje, negrita: false }]
  return [
    { texto: mensaje.slice(0, i), negrita: false },
    { texto: nombre, negrita: true },
    { texto: mensaje.slice(i + nombre.length), negrita: false },
  ].filter((parte) => parte.texto !== '')
}

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
  // Nombre del producto dentro del mensaje: se resalta en negrita en la vista (solo visual; lo que se envía no cambia).
  producto?: string
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
  producto,
  url,
  onCerrar,
  onAviso,
}: PropsDialogoWhatsApp) {
  const titulo = useRef<HTMLHeadingElement | null>(null)
  // Una `clave_envio` por apertura del diálogo (FR-024, FR-004): dos aperturas distintas registran dos
  // consultas; un doble clic sobre «Abrir WhatsApp» no puede registrar la misma apertura dos veces.
  const clave = useRef('')
  const registrando = useRef(false)
  const [copiado, setCopiado] = useState('')

  useEffect(() => {
    if (!abierto) return
    clave.current = nuevaClaveEnvioWhatsapp()
    registrando.current = false
    setCopiado('')
  }, [abierto])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(mensaje)
      setCopiado('Mensaje copiado')
    } catch {
      setCopiado('No se pudo copiar: seleccioná el texto a mano')
    }
  }

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
        {/* Círculo verde de WhatsApp del prototipo con el glifo en blanco (2:1 sobre el verde): es decorativo (`aria-hidden`; el título nombra la acción y el texto de los botones lleva el contraste AA), por eso no está sujeto a 1.4.11. */}
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
      {/* Vista del mensaje (prototipo: el producto en negrita). El campo de solo lectura de abajo lleva el mismo texto para lectores de
          pantalla y pruebas; la vista es `aria-hidden` para que no se lea dos veces y el texto se puede seleccionar y copiar. */}
      <Box
        aria-hidden
        data-testid="mensaje-whatsapp-vista"
        sx={(tema) => ({ bgcolor: tema.tienda?.superficie ?? 'action.hover', borderRadius: '10px', p: '14px', fontSize: 15, lineHeight: 1.5, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', userSelect: 'text' /* estilos-sueltos: ok */ })}
      >
        {partesMensaje(mensaje, producto).map((parte, i) => (parte.negrita ? <Box key={i} component="b">{parte.texto}</Box> : <span key={i}>{parte.texto}</span>))}
      </Box>
      {/* Campo de solo lectura para lectores de pantalla (oculto con el recorte estándar, acotado a 1 px de alto). No es parada de Tab: el
          teclado accede al texto con «Copiar mensaje». */}
      <InputBase
        id="mensaje-whatsapp"
        value={mensaje}
        multiline
        readOnly
        inputProps={{ tabIndex: -1 }}
        sx={{ ...SOLO_LECTORES, clipPath: 'inset(50%)', m: '-1px', p: 0, border: 0, '& textarea': { height: '1px !important', p: 0 } }}
      />
      <Button onClick={() => void copiar()} sx={{ display: 'block', mt: '6px', p: 0, minWidth: 0, fontSize: 13, fontWeight: 600, '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } /* estilos-sueltos: ok */ }}>
        Copiar mensaje
      </Button>
      <Typography role="status" aria-live="polite" sx={copiado ? { fontSize: 13, color: 'text.secondary', mt: '2px' /* estilos-sueltos: ok */ } : SOLO_LECTORES}>{copiado}</Typography>
      <Box sx={{ display: 'flex', gap: '10px', mt: '20px' }}>
        <Button
          onClick={onCerrar}
          sx={{ flex: 1, height: 44, border: '2px solid rgba(0,0,0,.15)', borderRadius: '8px', bgcolor: 'background.paper', color: 'text.primary', fontSize: 16, '&:hover': { bgcolor: 'background.paper', borderColor: 'rgba(0,0,0,.3)' }, '&.Mui-focusVisible, &:focus-visible': { outline: '3px solid', outlineColor: 'text.primary', outlineOffset: '2px' } /* estilos-sueltos: ok */ }}
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
