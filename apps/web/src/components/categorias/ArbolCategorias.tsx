import { useState, type DragEvent } from 'react'
import { Box, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import type { NodoCategoria } from '../../lib/categorias'
import { type Alicuota, formatearAlicuota } from '../../lib/iva'
import { tokens } from '../../tema/tokens'

type EmpresaVisible = { id: string; nombre: string }

type Props = {
  arbol: readonly NodoCategoria[]
  empresas: readonly EmpresaVisible[]
  // Alícuotas por id para la columna IVA (F-PRE-12, FR-020).
  alicuotas: ReadonlyMap<string, Alicuota>
  expandidos: ReadonlySet<string>
  onAlternar: (id: string) => void
  // Sin edición el árbol se ve sin acciones ni arrastre (FR-024).
  puedeEditar: boolean
  deshabilitado?: boolean
  onAgregarSubcategoria: (padre: NodoCategoria) => void
  onEditar: (categoria: NodoCategoria) => void
  onEliminar: (categoria: NodoCategoria) => void
  onMover: (categoria: NodoCategoria, delta: -1 | 1) => void
  onSoltar: (arrastradoId: string, destinoId: string) => void
}

const SOLO_LECTORES = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const
const LINEA = `1px solid ${tokens.color.borde}`

const textoSubcategorias = (cantidad: number) => `${cantidad} ${cantidad === 1 ? 'subcategoría' : 'subcategorías'}`

// Árbol de categorías (F-CAT-08, FR-018/FR-019): una lista con la categoría (con «N subcategorías»),
// los productos (con las subcategorías incluidas), el IVA, «Visible en» y las acciones. Arrastrar y soltar usa
// HTML5 nativo, sin librería; la alternativa por teclado es Subir/Bajar y «Categoría padre» del
// formulario, así ninguna función depende del mouse. Se reordena soltando una fila sobre otra.
export function ArbolCategorias({ arbol, empresas, alicuotas, expandidos, onAlternar, puedeEditar, deshabilitado = false, onAgregarSubcategoria, onEditar, onEliminar, onMover, onSoltar }: Props) {
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)

  const fila = (nodo: NodoCategoria, nivel: 0 | 1, hermanos: readonly NodoCategoria[]) => {
    const indice = hermanos.findIndex((hermano) => hermano.id === nodo.id)
    const abierto = expandidos.has(nodo.id)
    const arrastrable = puedeEditar && !deshabilitado
    return (
      <Box
        component="li"
        key={nodo.id}
        draggable={arrastrable}
        onDragStart={(evento: DragEvent) => {
          // Una subcategoría arrastrada no debe arrastrar también a su raíz (el <li> padre).
          evento.stopPropagation()
          evento.dataTransfer.effectAllowed = 'move'
          evento.dataTransfer.setData('text/plain', nodo.id)
          setArrastrando(nodo.id)
        }}
        onDragEnd={() => {
          setArrastrando(null)
          setSobre(null)
        }}
        onDragOver={(evento: DragEvent) => {
          if (!arrastrando || arrastrando === nodo.id) return
          evento.preventDefault()
          evento.dataTransfer.dropEffect = 'move'
          if (sobre !== nodo.id) setSobre(nodo.id)
        }}
        onDragLeave={() => setSobre((actual) => (actual === nodo.id ? null : actual))}
        onDrop={(evento: DragEvent) => {
          evento.preventDefault()
          evento.stopPropagation()
          const origen = arrastrando ?? evento.dataTransfer.getData('text/plain')
          setArrastrando(null)
          setSobre(null)
          if (origen && origen !== nodo.id) onSoltar(origen, nodo.id)
        }}
        sx={{
          listStyle: 'none',
          opacity: arrastrando === nodo.id ? 0.5 : 1,
          outline: sobre === nodo.id ? `2px dashed ${tokens.color.accion}` : 'none',
          borderBottom: LINEA,
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 0.5, md: 2 }} alignItems={{ md: 'center' }} sx={{ py: 1, pl: nivel === 1 ? { xs: 3, md: 5 } : 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 2, minWidth: 0 }}>
            {puedeEditar ? <DragIndicatorIcon fontSize="small" aria-hidden="true" sx={{ color: 'text.disabled', cursor: deshabilitado ? 'default' : 'grab' }} /> : null}
            {nodo.hijos.length > 0 ? (
              <IconButton
                size="small"
                aria-expanded={abierto}
                aria-label={`${abierto ? 'Contraer' : 'Expandir'} ${nodo.nombre}`}
                onClick={() => onAlternar(nodo.id)}
              >
                {abierto ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
              </IconButton>
            ) : (
              <Box sx={{ width: 34, flexShrink: 0 }} aria-hidden="true" />
            )}
            <Stack spacing={0} sx={{ minWidth: 0 }}>
              <Typography variant="b" sx={{ fontWeight: nivel === 0 ? tokens.tipografia.pesoEnfasis : undefined, overflowWrap: 'anywhere' }}>{nodo.nombre}</Typography>
              {nivel === 0 ? <Typography variant="xs">{textoSubcategorias(nodo.hijos.length)}</Typography> : null}
            </Stack>
          </Stack>
          <Typography variant="s" sx={{ flex: 1, textAlign: { md: 'right' } }}>
            <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>Productos: </Box>
            <Box component="span" sx={{ ...SOLO_LECTORES, display: { xs: 'none', md: 'inline' } }}>Productos: </Box>
            {nodo.productos}
          </Typography>
          <Typography variant="s" sx={{ flex: 1, textAlign: { md: 'right' } }}>
            <Box component="span" sx={{ display: { xs: 'inline', md: 'none' } }}>IVA: </Box>
            <Box component="span" sx={{ ...SOLO_LECTORES, display: { xs: 'none', md: 'inline' } }}>IVA: </Box>
            {nodo.alicuota_iva_id && alicuotas.get(nodo.alicuota_iva_id) ? formatearAlicuota(alicuotas.get(nodo.alicuota_iva_id) as Alicuota) : '—'}
          </Typography>
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ flex: 2 }}>
            <Box component="span" sx={SOLO_LECTORES}>Visible en:</Box>
            {empresas.length === 0 ? (
              <Typography variant="s" color="text.secondary">—</Typography>
            ) : (
              empresas.map((empresa) => {
                const visible = nodo.empresa_ids.includes(empresa.id)
                return (
                  <Chip
                    key={empresa.id}
                    size="small"
                    label={empresa.nombre}
                    color={visible ? 'primary' : 'default'}
                    variant={visible ? 'filled' : 'outlined'}
                    role="img"
                    aria-label={`${empresa.nombre}: ${visible ? 'se ve' : 'no se ve'}`}
                  />
                )
              })
            )}
          </Stack>
          {puedeEditar ? (
            <Stack direction="row" spacing={0} alignItems="center" sx={{ flexShrink: 0 }}>
              {nivel === 0 ? (
                <Tooltip title="Agregar subcategoría">
                  <span>
                    <IconButton size="small" disabled={deshabilitado} aria-label={`Agregar subcategoría a ${nodo.nombre}`} onClick={() => onAgregarSubcategoria(nodo)}>
                      <AddIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              ) : null}
              <Tooltip title="Subir">
                <span>
                  <IconButton size="small" disabled={deshabilitado || indice <= 0} aria-label={`Subir ${nodo.nombre}`} onClick={() => onMover(nodo, -1)}>
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Bajar">
                <span>
                  <IconButton size="small" disabled={deshabilitado || indice === hermanos.length - 1} aria-label={`Bajar ${nodo.nombre}`} onClick={() => onMover(nodo, 1)}>
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Editar">
                <span>
                  <IconButton size="small" disabled={deshabilitado} aria-label={`Editar ${nodo.nombre}`} onClick={() => onEditar(nodo)}>
                    <EditOutlinedIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Eliminar">
                <span>
                  <IconButton size="small" color="error" disabled={deshabilitado} aria-label={`Eliminar ${nodo.nombre}`} onClick={() => onEliminar(nodo)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          ) : null}
        </Stack>
      </Box>
    )
  }

  return (
    <Box>
      <Stack direction="row" spacing={2} aria-hidden="true" sx={{ display: { xs: 'none', md: 'flex' }, py: 1, borderBottom: LINEA }}>
        <Typography variant="s" sx={{ flex: 2, fontWeight: tokens.tipografia.pesoEnfasis }}>Categoría</Typography>
        <Typography variant="s" sx={{ flex: 1, textAlign: 'right', fontWeight: tokens.tipografia.pesoEnfasis }}>Productos</Typography>
        <Typography variant="s" sx={{ flex: 1, textAlign: 'right', fontWeight: tokens.tipografia.pesoEnfasis }}>IVA</Typography>
        <Typography variant="s" sx={{ flex: 2, fontWeight: tokens.tipografia.pesoEnfasis }}>Visible en</Typography>
        {puedeEditar ? <Typography variant="s" sx={{ width: 190, flexShrink: 0, textAlign: 'right', fontWeight: tokens.tipografia.pesoEnfasis }}>Acciones</Typography> : null}
      </Stack>
      <Box component="ul" aria-label="Categorías" sx={{ m: 0, p: 0 }}>
        {arbol.map((raiz) => (
          <Box component="li" key={raiz.id} sx={{ listStyle: 'none' }}>
            <Box component="ul" sx={{ m: 0, p: 0 }}>
              {fila(raiz, 0, arbol)}
              {expandidos.has(raiz.id) ? raiz.hijos.map((hija) => fila(hija, 1, raiz.hijos)) : null}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}
