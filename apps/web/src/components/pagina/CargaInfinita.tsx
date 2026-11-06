import { useEffect, useRef } from 'react'
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'
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
}

// Margen para pedir la tanda siguiente un poco antes de llegar al final del scroll.
const MARGEN_ANTICIPO = '400px'

// Pie de los listados con carga infinita (Constitución, Principio VI): al acercarse al final pide la tanda
// siguiente (`IntersectionObserver`) y la suma a lo ya mostrado. «Cargar más» es la alternativa operable con
// teclado (y la única vía donde no hay `IntersectionObserver`).
export function CargaInfinita({ hayMas, cargando, hayError = false, onCargarMas, mostrarFin = true }: CargaInfinitaProps) {
  const centinela = useRef<HTMLDivElement | null>(null)
  const alCargarMas = useRef(onCargarMas)
  alCargarMas.current = onCargarMas
  const activo = hayMas && !cargando && !hayError

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

  if (hayError) {
    return <EstadoError titulo="No pudimos cargar más resultados." reintentar={onCargarMas} />
  }
  if (cargando) {
    return (
      <Stack role="status" aria-label="Cargando más resultados" alignItems="center" sx={{ py: 2 }}>
        <CircularProgress size={24} />
      </Stack>
    )
  }
  if (hayMas) {
    return (
      <Box ref={centinela} sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <Button variant="outlined" onClick={onCargarMas}>Cargar más</Button>
      </Box>
    )
  }
  return mostrarFin ? (
    <Typography variant="xs" color="text.secondary" align="center" component="p" sx={{ py: 2 }}>No hay más resultados.</Typography>
  ) : null
}
