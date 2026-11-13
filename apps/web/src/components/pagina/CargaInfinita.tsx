import { useEffect, useRef, useState } from 'react'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import { EstadoError } from '../estados/EstadosPagina'

type CargaInfinitaProps = {
  // Hay más filas en el servidor que las ya mostradas.
  hayMas: boolean
  // Se está pidiendo la tanda siguiente.
  cargando: boolean
  // La tanda siguiente falló: se muestra el error con «Reintentar» sin tirar abajo lo ya cargado.
  hayError?: boolean
  onCargarMas: () => void
  // Texto de fin de lista; sin filas mostradas no se dibuja.
  mostrarFin?: boolean
  // Filas mostradas hasta ahora: permite anunciar «N productos más cargados» (sin esto, un aviso genérico).
  cargados?: number
  // La tanda falló por un límite de pedidos: se explica la espera y «Reintentar» queda deshabilitado hasta que
  // pasen los segundos indicados. El objeto es la identidad del aviso (uno nuevo reinicia la espera).
  espera?: { mensaje: string; segundos: number } | null
}

// Oculto a la vista pero leído por lectores de pantalla.
const OCULTO_VISUAL = {
  border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px',
} as const

// Margen para pedir la tanda siguiente un poco antes de llegar al final del scroll.
const MARGEN_ANTICIPO = '400px'

// Pie de los listados con carga infinita (Constitución, Principio VI): al acercarse al final pide la tanda
// siguiente (`IntersectionObserver`) y la suma a lo ya mostrado. «Cargar más» es la alternativa operable con
// teclado (y la única vía donde no hay `IntersectionObserver`). Accesibilidad: el botón sigue montado
// (`aria-disabled`/`aria-busy`) mientras carga para que el foco no caiga al body; al terminar la lista el foco
// pasa al texto de fin; y una región viva siempre presente anuncia el progreso con texto.
export function CargaInfinita({ hayMas, cargando, hayError = false, onCargarMas, mostrarFin = true, cargados, espera = null }: CargaInfinitaProps) {
  const centinela = useRef<HTMLDivElement | null>(null)
  const fin = useRef<HTMLParagraphElement | null>(null)
  // El foco está en «Cargar más» o en el error con «Reintentar»: al cambiar de uno al otro se devuelve (no cae al body).
  const focoEnBoton = useRef(false)
  const zona = useRef<HTMLDivElement | null>(null)
  const zonaError = useRef<HTMLDivElement | null>(null)
  const alCargarMas = useRef(onCargarMas)
  const cargadosAntes = useRef<number | undefined>(cargados)
  const [anuncio, setAnuncio] = useState('')
  // Último aviso de espera cuyo tiempo ya pasó.
  const [esperaCumplida, setEsperaCumplida] = useState<object | null>(null)
  const esperando = espera !== null && esperaCumplida !== espera
  const activo = hayMas && !cargando && !hayError
  const botonVisible = (hayMas || cargando) && !hayError
  const terminado = !hayMas && !cargando && !hayError

  useEffect(() => {
    alCargarMas.current = onCargarMas
  }, [onCargarMas])

  useEffect(() => {
    const nodo = centinela.current
    if (!activo || !nodo || typeof IntersectionObserver === 'undefined') return
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((entrada) => entrada.isIntersecting)) alCargarMas.current()
      },
      { rootMargin: MARGEN_ANTICIPO },
    )
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [activo])

  useEffect(() => {
    if (!espera) return undefined
    const temporizador = setTimeout(() => setEsperaCumplida(espera), espera.segundos * 1000)
    return () => clearTimeout(temporizador)
  }, [espera])

  // Texto de la región viva según la fase.
  useEffect(() => {
    const antes = cargadosAntes.current
    cargadosAntes.current = cargados
    if (cargando) {
      setAnuncio('Cargando más resultados')
    } else if (hayError) {
      // El error ya se anuncia solo (`role=alert` de EstadoError, también el aviso de espera): repetirlo acá lo leería dos veces.
      setAnuncio('')
    } else if (!hayMas) {
      const nuevos = cargados !== undefined && antes !== undefined ? cargados - antes : 0
      // Sin pie de fin (lista vacía de una pantalla del panel) no se anuncia el fin: sería ruido.
      const fin = mostrarFin ? 'No hay más resultados' : ''
      setAnuncio(nuevos > 0 ? `${nuevos} productos más cargados${fin ? `. ${fin}` : ''}` : fin)
    } else {
      const nuevos = cargados !== undefined && antes !== undefined ? cargados - antes : 0
      setAnuncio(nuevos > 0 ? `${nuevos} productos más cargados` : '')
    }
  }, [cargando, hayError, hayMas, cargados, espera, mostrarFin])

  // Si el control enfocado desaparece (el botón porque no hay más; «Reintentar» porque se vuelve a pedir; «Cargar más»
  // porque la tanda falló) el foco pasa al que lo reemplaza o al texto de fin, nunca al body.
  useEffect(() => {
    if (!focoEnBoton.current) return
    // Solo se restaura si el foco se perdió (cayó al body) o sigue en la zona: si el usuario pasó a otro campo
    // (o el navegador no enfocó el botón al hacer clic, como Safari/Firefox en macOS) no se le roba.
    const actual = document.activeElement
    const perdido = !actual || actual === document.body
    if (!perdido && !zona.current?.contains(actual)) {
      focoEnBoton.current = false
      return
    }
    if (terminado) {
      focoEnBoton.current = false
      fin.current?.focus()
      return
    }
    const control = zona.current?.querySelector<HTMLElement>('button:not(:disabled)')
    if (control) control.focus()
    else if (hayError) zonaError.current?.focus()
  }, [terminado, hayError, cargando])

  // La región viva (`aria-live`, sin `role=status` para no duplicar el rol de otras regiones de la página) queda montada siempre en la misma posición del árbol para que se anuncien sus cambios.
  return (
    <Box ref={botonVisible && !hayError ? centinela : undefined} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
      <Box aria-live="polite" aria-atomic="true" sx={OCULTO_VISUAL} data-testid="carga-infinita-anuncio">
        {anuncio}
      </Box>
      <Box
        ref={zona}
        onFocus={() => { focoEnBoton.current = true }}
        onBlur={(e) => { if ((e.target as Element).isConnected) focoEnBoton.current = false }}
        sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
      {hayError ? (
        <Box ref={zonaError} tabIndex={-1} sx={{ outline: 'none' }}>
          <EstadoError
            titulo={espera ? espera.mensaje : 'No pudimos cargar más resultados.'}
            reintentar={onCargarMas}
            reintentarDeshabilitado={esperando}
          />
        </Box>
      ) : null}
      {botonVisible ? (
        <Button
          variant="outlined"
          // Cargando: el botón sigue enfocable (aria-disabled) pero se ve apagado, como un MUI deshabilitado.
          sx={{
            '&[aria-disabled="true"], &[aria-disabled="true"]:hover': { color: 'action.disabled', borderColor: 'action.disabledBackground', bgcolor: 'transparent', cursor: 'progress' },
          }}
          aria-disabled={cargando || undefined}
          aria-busy={cargando || undefined}
          startIcon={cargando ? <CircularProgress size={16} /> : undefined}
          onClick={(e) => {
            // Safari y Firefox en macOS no enfocan el botón al hacer clic: la marca vale si el foco está en él o se perdió.
            const actual = document.activeElement
            focoEnBoton.current = actual === e.currentTarget || !actual || actual === document.body
            if (!cargando) onCargarMas()
          }}
        >
          Cargar más
        </Button>
      ) : null}
      </Box>
      {terminado && mostrarFin ? (
        <Typography ref={fin} tabIndex={-1} variant="xs" color="text.secondary" align="center" component="p" sx={{ outline: 'none' }}>
          No hay más resultados.
        </Typography>
      ) : null}
    </Box>
  )
}
