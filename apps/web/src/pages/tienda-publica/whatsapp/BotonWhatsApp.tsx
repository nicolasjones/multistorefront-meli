import { Alert, Box, Button } from '@mui/material'
import { lazy, Suspense, useState } from 'react'
import { armarMensaje, urlWhatsapp } from '../../../lib/whatsapp'
import { IconoWhatsapp } from './IconoWhatsapp'
import { useContactoWhatsapp } from './useContactoWhatsapp'

// El diálogo se carga diferida (FR-021): el módulo entra al bundle recién cuando la tienda tiene un
// número válido, y el botón abre el diálogo sin esperarlo.
const DialogoWhatsApp = lazy(() => import('./DialogoWhatsApp'))

export type PropsBotonWhatsApp = {
  // Host de la tienda: de acá sale la empresa y su número.
  host: string
  // Nombre de la empresa que se muestra en el diálogo y en el mensaje.
  empresa: string
  // Nombre del producto que se consulta.
  producto: string
  // Identificador del producto que se registra en la bandeja.
  productoId: string
  // Precio final del producto (null si no tiene).
  precio?: number | null
}

// Botón «Consultar por WhatsApp» de la ficha (F-TDA-14, FR-020, FR-021, FR-026). Aparece SOLO si la
// empresa tiene un número válido: sin número la ficha se ve sin botón y sin hueco. Abre el diálogo con
// el mensaje ya armado; «Abrir WhatsApp» abre `wa.me` y avisa que quedó listo.
export function BotonWhatsApp({ host, empresa, producto, productoId, precio = null }: PropsBotonWhatsApp) {
  const contacto = useContactoWhatsapp(host)
  const [abierto, setAbierto] = useState(false)
  const [aviso, setAviso] = useState(false)

  if (contacto.fase !== 'listo') return null

  const nombreEmpresa = empresa.trim() || contacto.contacto.nombre
  const mensaje = armarMensaje(nombreEmpresa, producto, precio)
  const url = urlWhatsapp(contacto.contacto.numero, mensaje)
  if (!url) return null

  return (
    // El ancho vive en ESTE elemento (el que la fila de acciones de la ficha acomoda): un `width: 100%`
    // dentro de un contenedor de ancho automático se resuelve como `auto` (CSS 2.1 §10.3.2), así que el
    // botón quedaría más angosto que «Ver más productos» en celular. Acá sí es el ancho completo
    // (como en el prototipo móvil) y desde `sm` el botón va en línea con el resto de la fila.
    <Box data-testid="boton-whatsapp" sx={{ width: { xs: '100%', sm: 'auto' } }}>
      <Button
        variant="contained"
        onClick={() => { setAviso(false); setAbierto(true) }}
        startIcon={<IconoWhatsapp />}
        sx={{ minHeight: (tema) => tema.spacing(5.5), fontWeight: 700, borderRadius: (tema) => `${tema.shape.borderRadius}px`, width: '100%' }}
      >
        Consultar por WhatsApp
      </Button>
      {aviso ? (
        <Alert severity="success" role="status" sx={{ mt: 1 }}>Se abrió WhatsApp con el mensaje listo.</Alert>
      ) : null}
      <Suspense fallback={null}>
        <DialogoWhatsApp
          abierto={abierto}
          host={host}
          productoId={productoId}
          empresa={nombreEmpresa}
          numero={contacto.contacto.numero}
          mensaje={mensaje}
          url={url}
          onCerrar={() => setAbierto(false)}
          onAviso={() => setAviso(true)}
        />
      </Suspense>
    </Box>
  )
}
