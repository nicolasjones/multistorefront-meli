import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, FormHelperText, IconButton, Stack, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import {
  AYUDA_IMAGENES,
  type CambiosImagenes,
  type ImagenExistente,
  MAX_IMAGENES,
  TIPOS_ACEPTADOS,
  ordenFinal,
  validarArchivo,
} from '../../lib/productoImagenes'

type Props = {
  existentes: readonly ImagenExistente[]
  cambios: CambiosImagenes
  onCambiar: (cambios: CambiosImagenes) => void
  // Solo lectura (FR-011): se ven las imágenes, sin agregar ni quitar.
  soloLectura?: boolean
  deshabilitado?: boolean
}

// Vista previa local de un archivo recién elegido; se libera al quitarlo o desmontar.
function useVistasPrevias(archivos: readonly File[]): Map<File, string> {
  const vistas = useMemo(() => {
    const mapa = new Map<File, string>()
    if (typeof URL.createObjectURL !== 'function') return mapa
    for (const archivo of archivos) mapa.set(archivo, URL.createObjectURL(archivo))
    return mapa
  }, [archivos])
  useEffect(() => () => {
    if (typeof URL.revokeObjectURL !== 'function') return
    for (const url of vistas.values()) URL.revokeObjectURL(url)
  }, [vistas])
  return vistas
}

// Imágenes del producto (F-CAT-05, FR-012): hasta 4, JPG/PNG/WebP de 2 MB; la primera
// es la principal. Los archivos se suben al guardar el producto (lo hace la página);
// acá solo se elige y se valida. La base y el bucket validan igual.
export function ImagenesProducto({ existentes, cambios, onCambiar, soloLectura = false, deshabilitado = false }: Props) {
  const [errores, setErrores] = useState<string[]>([])
  const entrada = useRef<HTMLInputElement | null>(null)
  const vistas = useVistasPrevias(cambios.nuevas)
  const orden = ordenFinal(existentes, cambios)
  const bloqueado = soloLectura || deshabilitado

  const agregar = (event: ChangeEvent<HTMLInputElement>) => {
    const elegidos = Array.from(event.target.files ?? [])
    event.target.value = ''
    const rechazos: string[] = []
    const aceptados: File[] = []
    let cantidad = orden.length
    for (const archivo of elegidos) {
      const rechazo = validarArchivo(archivo, cantidad)
      if (rechazo) {
        rechazos.push(rechazo)
      } else {
        aceptados.push(archivo)
        cantidad += 1
      }
    }
    setErrores(rechazos)
    if (aceptados.length > 0) {
      onCambiar({ ...cambios, nuevas: [...cambios.nuevas, ...aceptados] })
    }
  }

  const quitar = (elemento: (typeof orden)[number]) => {
    setErrores([])
    if (elemento.tipo === 'nueva') {
      onCambiar({ ...cambios, nuevas: cambios.nuevas.filter((archivo) => archivo !== elemento.archivo) })
    } else {
      onCambiar({ ...cambios, eliminadas: [...cambios.eliminadas, elemento.imagen.id] })
    }
  }

  return (
    <Box component="section" aria-labelledby="imagenes-titulo">
      <Typography id="imagenes-titulo" variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        Imágenes
      </Typography>
      <FormHelperText id="imagenes-ayuda">{AYUDA_IMAGENES}</FormHelperText>
      {errores.length > 0 ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Stack component="ul" sx={{ m: 0, pl: 2 }}>
            {errores.map((error) => <li key={error}>{error}</li>)}
          </Stack>
        </Alert>
      ) : null}
      {orden.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {soloLectura ? 'Este producto no tiene imágenes.' : 'Todavía no hay imágenes.'}
        </Typography>
      ) : (
        <Stack component="ul" direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap', listStyle: 'none', m: 0, mt: 1, p: 0 }}>
          {orden.map((elemento, indice) => {
            const url = elemento.tipo === 'nueva' ? vistas.get(elemento.archivo) ?? null : elemento.imagen.url
            const descripcion = `Imagen ${indice + 1}${indice === 0 ? ' (principal)' : ''}${elemento.tipo === 'nueva' ? ', se sube al guardar' : ''}`
            return (
              <Box component="li" key={elemento.tipo === 'nueva' ? `nueva:${elemento.archivo.name}:${elemento.archivo.lastModified}:${indice}` : elemento.imagen.id} sx={{ position: 'relative', width: 112 }}>
                {url ? (
                  <Box component="img" src={url} alt={descripcion} sx={{ width: 112, height: 112, objectFit: 'cover', borderRadius: 1, border: 1, borderColor: 'divider', display: 'block' }} />
                ) : (
                  <Box role="img" aria-label={descripcion} sx={{ width: 112, height: 112, borderRadius: 1, border: 1, borderColor: 'divider', display: 'grid', placeItems: 'center', bgcolor: 'action.hover' }}>
                    <Typography variant="caption" color="text.secondary">Sin vista previa</Typography>
                  </Box>
                )}
                {indice === 0 ? <Chip label="Principal" size="small" color="primary" sx={{ position: 'absolute', top: 4, left: 4 }} /> : null}
                {bloqueado ? null : (
                  <IconButton
                    size="small"
                    aria-label={`Quitar imagen ${indice + 1}`}
                    onClick={() => quitar(elemento)}
                    sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'background.paper', '&:hover': { bgcolor: 'background.paper' } }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Stack>
      )}
      {bloqueado ? null : (
        <Box sx={{ mt: 1.5 }}>
          <input
            ref={entrada}
            type="file"
            accept={TIPOS_ACEPTADOS}
            multiple
            hidden
            onChange={agregar}
            aria-label="Elegir imágenes"
            data-testid="entrada-imagenes"
          />
          <Button variant="outlined" onClick={() => entrada.current?.click()} disabled={orden.length >= MAX_IMAGENES} aria-describedby="imagenes-ayuda">
            Agregar imágenes
          </Button>
        </Box>
      )}
    </Box>
  )
}
