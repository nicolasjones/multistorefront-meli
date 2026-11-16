import type { KeyboardEvent, ReactNode, SyntheticEvent } from 'react'
import { Box } from '@mui/material'

const detener = (evento: SyntheticEvent) => {
  evento.preventDefault()
  evento.stopPropagation()
}
// Los eventos táctiles de React son pasivos: no admiten preventDefault, solo se cortan.
const soloCortar = (evento: SyntheticEvent) => evento.stopPropagation()
// Tab no se cancela: con `inert` el foco ya sale de la zona y bloquearlo atraparía el teclado donde `inert` no exista.
// Escape: un diálogo/menú de MUI que ya estaba abierto en un portal cuando falló el repedido deja la persona atrapada
// (foco atrapado, aviso tapado por el telón). Escape en el portal pasa para que pueda CERRARlo; cerrar no guarda nada.
// Dentro del DOM de la zona (inerte) Escape sigue cortado.
const detenerTecla = (evento: KeyboardEvent) => {
  if (evento.key === 'Escape' && evento.target instanceof Node && !evento.currentTarget.contains(evento.target)) return
  if (evento.key !== 'Tab') evento.preventDefault()
  evento.stopPropagation()
}

// MSF-855: envuelve los hijos de `RequiereAccesoSeccion`. Siempre está en el árbol (los hijos no se remontan al pasar
// de normal a inerte). Con `bloqueada`: `fieldset disabled` + `inert` (nada recibe foco ni puntero) y, además, captura
// en React los eventos de edición y de envío: los eventos de React suben por el árbol de componentes, así que esto
// también alcanza a diálogos y menús que MUI saca a un portal fuera del DOM de la zona. El servidor (RLS) sigue siendo
// la autoridad; esto es solo la UI.
export function ZonaInerte({ bloqueada, children }: { bloqueada: boolean; children: ReactNode }) {
  const atributos = bloqueada
    ? ({
        disabled: true,
        inert: '',
        onClickCapture: detener,
        onDoubleClickCapture: detener,
        onMouseDownCapture: detener,
        onPointerDownCapture: detener,
        onSubmitCapture: detener,
        onChangeCapture: detener,
        onInputCapture: detener,
        onBeforeInputCapture: detener,
        onPasteCapture: detener,
        onCutCapture: detener,
        onDropCapture: detener,
        onDragStartCapture: detener,
        onDragEnterCapture: detener,
        onDragOverCapture: detener,
        onMouseUpCapture: detener,
        onPointerUpCapture: detener,
        onTouchStartCapture: soloCortar,
        onTouchEndCapture: soloCortar,
        onAuxClickCapture: detener,
        onCompositionEndCapture: detener,
        onKeyPressCapture: detener,
        onKeyDownCapture: detenerTecla,
        onKeyUpCapture: detenerTecla,
      } as Record<string, unknown>)
    : {}
  return (
    <Box component="fieldset" sx={{ display: 'contents', border: 0, m: 0, p: 0, minWidth: 0 }} {...atributos}>
      {children}
    </Box>
  )
}
