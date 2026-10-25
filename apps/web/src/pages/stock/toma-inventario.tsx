import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { EstadoCargaPagina, EstadoError, EstadoExito, EstadoVacio } from '../../components/estados/EstadosPagina'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { armarArbol, leerCategoriasSelector, opcionesCategoriaProducto, type Categoria } from '../../lib/categorias'
import { supabaseClient } from '../../lib/supabase'
import {
  MENSAJE_TOMA_CONFIRMADA, armarItemsToma, cargarFilasToma, confirmarToma, diferenciaToma, mensajeDeErrorToma,
  rotularDiferencia, validarToma, type AjusteToma, type FilaToma,
} from '../../lib/tomaInventario'
import { PestanasStock } from './PestanasStock'

type Resultado = { ajustes: AjusteToma[]; nombres: Record<string, string> }

// Ids que cubre una opción del selector: una categoría raíz incluye sus subcategorías.
function idsDeOpcion(categorias: readonly Categoria[], categoriaId: string): string[] {
  const raiz = armarArbol(categorias).find((nodo) => nodo.id === categoriaId)
  return raiz ? [raiz.id, ...raiz.hijos.map((hijo) => hijo.id)] : [categoriaId]
}

// F-STK-11: pestaña «Toma de inventario» dentro de Stock. Se elige una categoría, se carga lo contado
// y «Confirmar» corrige las diferencias con ajustes (RPC `confirmar_toma_inventario`, todo o nada).
// La pantalla no está en el prototipo (se construye con el sistema de diseño); no consulta por empresa:
// el stock es único por organización. «Confirmar» se oculta sin edición; la autoridad es la base.
export function TomaInventario() {
  const { nivel, isLoading: cargandoNivel } = useNivelSeccion('stock')
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriasListas, setCategoriasListas] = useState(false)
  const [errorCategorias, setErrorCategorias] = useState(false)
  const [categoriaId, setCategoriaId] = useState('')
  const [filas, setFilas] = useState<FilaToma[]>([])
  const [cargandoFilas, setCargandoFilas] = useState(false)
  const [errorFilas, setErrorFilas] = useState<string | null>(null)
  const [contados, setContados] = useState<Record<string, string>>({})
  const [intentoConfirmar, setIntentoConfirmar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [recargaCategorias, setRecargaCategorias] = useState(0)
  const [recargaFilas, setRecargaFilas] = useState(0)

  useEffect(() => {
    let vigente = true
    setErrorCategorias(false)
    leerCategoriasSelector(supabaseClient)
      .then((lista) => { if (vigente) { setCategorias(lista); setCategoriasListas(true) } })
      .catch((error) => {
        console.error('No pudimos cargar las categorías.', error)
        if (vigente) setErrorCategorias(true)
      })
    return () => { vigente = false }
  }, [recargaCategorias])

  useEffect(() => {
    if (categoriaId === '') { setFilas([]); return }
    let vigente = true
    setCargandoFilas(true)
    setErrorFilas(null)
    setContados({})
    setIntentoConfirmar(false)
    cargarFilasToma(idsDeOpcion(categorias, categoriaId))
      .then((lista) => { if (vigente) { setFilas(lista); setCargandoFilas(false) } })
      .catch((error) => {
        console.error('No pudimos cargar los productos de la toma.', error)
        if (vigente) {
          setErrorFilas(error instanceof Error && error.message.startsWith('La categoría tiene más')
            ? error.message : 'No pudimos cargar los productos de esta categoría.')
          setCargandoFilas(false)
        }
      })
    return () => { vigente = false }
  // `categorias` solo se lee para resolver las subcategorías; cambiar de categoría o reintentar recarga.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriaId, recargaFilas])

  const opciones = useMemo(() => opcionesCategoriaProducto(categorias), [categorias])
  const erroresContado = validarToma(contados)
  const hayContados = armarItemsToma(filas, contados).length > 0
  const puedeConfirmar = nivel === 'edicion'

  const confirmar = useCallback(async () => {
    if (enviando) return
    setIntentoConfirmar(true)
    if (Object.keys(validarToma(contados)).length > 0) return
    const items = armarItemsToma(filas, contados)
    if (items.length === 0) return
    setEnviando(true)
    setErrorEnvio(null)
    try {
      const ajustes = await confirmarToma(items)
      setResultado({ ajustes, nombres: Object.fromEntries(filas.map((fila) => [fila.producto_id, fila.nombre])) })
    } catch (error) {
      setErrorEnvio(mensajeDeErrorToma(error, 'No pudimos confirmar la toma. No se guardó ningún ajuste: probá de nuevo.'))
    } finally {
      setEnviando(false)
    }
  }, [contados, enviando, filas])

  const nuevaToma = () => {
    setResultado(null)
    setContados({})
    setIntentoConfirmar(false)
    setErrorEnvio(null)
    setRecargaFilas((valor) => valor + 1)
  }

  return (
    <Box>
      <EncabezadoPagina titulo="Stock" contexto={<ContextoOrganizacionActiva />} />
      <ContenedorSeccion>
        <PestanasStock activa="toma" />
        {resultado ? (
          <ResultadoToma resultado={resultado} onNueva={nuevaToma} />
        ) : errorCategorias ? (
          <EstadoError reintentar={() => setRecargaCategorias((valor) => valor + 1)} />
        ) : !categoriasListas || cargandoNivel ? (
          <EstadoCargaPagina />
        ) : (
          <Stack spacing={2}>
            {!puedeConfirmar && (
              <Alert severity="info">Tu rol puede ver la toma, pero no confirmarla.</Alert>
            )}
            <FormControl sx={{ maxWidth: 420 }}>
              <InputLabel id="toma-categoria-etiqueta">Categoría</InputLabel>
              <Select
                labelId="toma-categoria-etiqueta"
                label="Categoría"
                value={categoriaId}
                onChange={(evento) => setCategoriaId(evento.target.value)}
              >
                {opciones.map((opcion) => <MenuItem key={opcion.id} value={opcion.id}>{opcion.ruta}</MenuItem>)}
              </Select>
            </FormControl>
            {categoriaId === '' ? (
              <EstadoVacio titulo="Elegí una categoría" descripcion="Vas a contar sus productos y corregir las diferencias con ajustes." />
            ) : cargandoFilas ? (
              <EstadoCargaPagina />
            ) : errorFilas ? (
              <EstadoError titulo={errorFilas} reintentar={() => setRecargaFilas((valor) => valor + 1)} />
            ) : filas.length === 0 ? (
              <EstadoVacio titulo="Esta categoría no tiene productos" descripcion="Elegí otra categoría para hacer la toma." />
            ) : (
              <>
                <TableContainer>
                  <Table size="small" aria-label="Productos de la toma de inventario">
                    <TableHead>
                      <TableRow>
                        <TableCell>Producto / SKU</TableCell>
                        <TableCell align="right">Stock en el sistema</TableCell>
                        <TableCell align="right">Contado</TableCell>
                        <TableCell align="right">Diferencia</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filas.map((fila) => {
                        const diferencia = diferenciaToma(fila.sistema, contados[fila.producto_id])
                        const error = intentoConfirmar || contados[fila.producto_id] ? erroresContado[fila.producto_id] : undefined
                        return (
                          <TableRow key={fila.producto_id}>
                            <TableCell>
                              <Typography variant="body2">{fila.nombre}</Typography>
                              {fila.sku && <Typography variant="caption" color="text.secondary">{fila.sku}</Typography>}
                            </TableCell>
                            <TableCell align="right">{fila.sistema}</TableCell>
                            <TableCell align="right">
                              <TextField
                                size="small"
                                value={contados[fila.producto_id] ?? ''}
                                onChange={(evento) => setContados((previo) => ({ ...previo, [fila.producto_id]: evento.target.value }))}
                                error={Boolean(error)}
                                helperText={error}
                                disabled={enviando}
                                slotProps={{ htmlInput: { 'aria-label': `Contado de ${fila.nombre}`, inputMode: 'numeric' } }}
                                sx={{ width: 140 }}
                              />
                            </TableCell>
                            <TableCell align="right">{diferencia === null ? '—' : rotularDiferencia(diferencia)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {errorEnvio && <Alert severity="error">{errorEnvio}</Alert>}
                {puedeConfirmar && (
                  <Box>
                    <Button variant="contained" onClick={confirmar} disabled={enviando || !hayContados}>
                      {enviando ? 'Confirmando…' : 'Confirmar'}
                    </Button>
                    {!hayContados && (
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
                        Cargá el contado de al menos un producto. Los que dejes vacíos no se tocan.
                      </Typography>
                    )}
                  </Box>
                )}
              </>
            )}
          </Stack>
        )}
      </ContenedorSeccion>
    </Box>
  )
}

function ResultadoToma({ resultado, onNueva }: { resultado: Resultado; onNueva: () => void }) {
  const { ajustes, nombres } = resultado
  return (
    <Stack spacing={2}>
      <EstadoExito
        titulo={MENSAJE_TOMA_CONFIRMADA}
        descripcion={ajustes.length === 0
          ? 'No había diferencias: no se generó ningún ajuste.'
          : `Se generaron ${ajustes.length} ${ajustes.length === 1 ? 'ajuste' : 'ajustes'}. Los ves también en Movimientos.`}
      />
      {ajustes.length > 0 && (
        <TableContainer>
          <Table size="small" aria-label="Ajustes generados por la toma">
            <TableHead>
              <TableRow>
                <TableCell>Producto</TableCell>
                <TableCell align="right">Diferencia</TableCell>
                <TableCell align="right">Saldo</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ajustes.map((ajuste) => (
                <TableRow key={ajuste.movimiento_id}>
                  <TableCell>{nombres[ajuste.producto] ?? ajuste.producto}</TableCell>
                  <TableCell align="right">{rotularDiferencia(ajuste.diferencia)}</TableCell>
                  <TableCell align="right">{ajuste.saldo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Box><Button variant="outlined" onClick={onNueva}>Hacer otra toma</Button></Box>
    </Stack>
  )
}
