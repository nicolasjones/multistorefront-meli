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
  const focoEnBoton = useRef(false)
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
      setAnuncio(espera ? espera.mensaje : '')
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

  // Si el botón tenía el foco y desaparece porque no hay más, el foco pasa al texto de fin (no al body).
  useEffect(() => {
    if (terminado && focoEnBoton.current) {
      focoEnBoton.current = false
      fin.current?.focus()
    }
  }, [terminado])

  // La región viva (`aria-live`, sin `role=status` para no duplicar el rol de otras regiones de la página) queda montada siempre en la misma posición del árbol para que se anuncien sus cambios.
  return (
    <Box ref={botonVisible && !hayError ? centinela : undefined} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2 }}>
      <Box aria-live="polite" aria-atomic="true" sx={OCULTO_VISUAL} data-testid="carga-infinita-anuncio">
        {anuncio}
      </Box>
      {hayError ? <EstadoError
          titulo={espera ? espera.mensaje : 'No pudimos cargar más resultados.'}
          reintentar={onCargarMas}
          reintentarDeshabilitado={esperando}
        /> : null}
      {botonVisible ? (
        <Button
          variant="outlined"
          aria-disabled={cargando || undefined}
          aria-busy={cargando || undefined}
          startIcon={cargando ? <CircularProgress size={16} /> : undefined}
          onClick={() => {
            focoEnBoton.current = true
            if (!cargando) onCargarMas()
          }}
          onFocus={() => { focoEnBoton.current = true }}
          onBlur={(e) => { if (e.currentTarget.isConnected) focoEnBoton.current = false }}
        >
          Cargar más
        </Button>
      ) : null}
      {terminado && mostrarFin ? (
        <Typography ref={fin} tabIndex={-1} variant="xs" color="text.secondary" align="center" component="p" sx={{ outline: 'none' }}>
          No hay más resultados.
        </Typography>
      ) : null}
    </Box>
  )
}
