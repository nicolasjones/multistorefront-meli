import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, Link as RouterLink } from 'react-router'
import {
  Alert, Box, Button, Chip, Link, LinearProgress, Snackbar, Stack, TablePagination, TextField, Tooltip, Typography,
} from '@mui/material'
import { useNivelSeccion } from '../../hooks/useNivelSeccion'
import { useFiltroPorEmpresaActiva } from '../../hooks/useFiltroPorEmpresaActiva'
import { useLibretaContactos } from '../../hooks/useContactos'
import { TAMANO_PAGINA_CONTACTOS, TEXTO_SIN_PERMISO_EDICION, type Contacto } from '../../lib/contactos'
import { FiltroEmpresa } from '../../components/pagina/FiltroEmpresa'
import { EstadoCargaPagina, EstadoError, EstadoVacio } from '../../components/estados/EstadosPagina'
import { EncabezadoPagina } from '../../components/pagina/EncabezadoPagina'
import { ContenedorSeccion } from '../../components/pagina/ContenedorSeccion'
import { ContenidoAdaptable, type ColumnaAdaptable } from '../../components/pagina/ContenidoAdaptable'
import { ContextoOrganizacionActiva } from '../../components/pagina/ContextoOrganizacionActiva'
import { CrearContactoDialog } from '../consultas/CrearContactoDialog'

const ESPERA_BUSQUEDA_MS = 300
const ALTO_BARRA_CARGA = 2
const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const // estilos-sueltos: ok: oculta visualmente sin quitar del lector

const textoConteo = (total: number) => `${total} ${total === 1 ? 'contacto' : 'contactos'}`

// Libreta de contactos (F-CON-05, FR-005). Sin prototipo dibujado: usa los patrones compartidos del panel.
// La empresa activa de la barra superior es la fuente de verdad del filtro (Principio VIII, FR-012): al
// cambiarla se recarga todo, se reencuadra la paginación y se cierra el formulario abierto con aviso.
export function ContactoList() {
  const { nivel } = useNivelSeccion('consultas')
  const puedeEditar = nivel === 'edicion'
  const navigate = useNavigate()
  const ubicacion = useLocation()
  const avisoInicial = (ubicacion.state as { aviso?: string } | null)?.aviso ?? null

  const {
    empresas, valor: empresaId, cambiar: elegirEmpresa, cargando: cargandoTiendas, hayError: errorTiendas,
  } = useFiltroPorEmpresaActiva()
  const listo = !cargandoTiendas

  const [texto, setTexto] = useState('')
  const [textoAplicado, setTextoAplicado] = useState('')
  const [pagina, setPagina] = useState(1)
  const [creando, setCreando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(avisoInicial)

  useEffect(() => {
    const espera = setTimeout(() => {
      if (texto !== textoAplicado) {
        setTextoAplicado(texto)
        setPagina(1)
      }
    }, ESPERA_BUSQUEDA_MS)
    return () => clearTimeout(espera)
  }, [texto, textoAplicado])

  // Cambió la empresa (barra superior): paginación a la primera y formulario cerrado con aviso.
  const ultimaEmpresa = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (!listo) return
    if (ultimaEmpresa.current === undefined) {
      ultimaEmpresa.current = empresaId
      return
    }
    if (ultimaEmpresa.current !== empresaId) {
      ultimaEmpresa.current = empresaId
      setPagina(1)
    }
  }, [listo, empresaId])

  const { contactos, total, isLoading, isFetching, isError, refetch } = useLibretaContactos(
    { empresaId, texto: textoAplicado, pagina, tamano: TAMANO_PAGINA_CONTACTOS },
    { habilitado: listo },
  )

  useEffect(() => {
    if (!isLoading && !isFetching && !isError && contactos.length === 0 && pagina > 1) setPagina(1)
  }, [isLoading, isFetching, isError, contactos.length, pagina])

  const hayFiltros = textoAplicado.trim() !== '' || empresaId !== null
  const empresaNueva = empresaId ? empresas.find((e) => e.id === empresaId) ?? null : null

  const columnas: ColumnaAdaptable<Contacto>[] = [
    {
      clave: 'nombre', encabezado: 'Nombre',
      render: (c) => (
        <Stack spacing={0} sx={{ alignItems: 'flex-start' }}>
          <Link component={RouterLink} to={`/contactos/${c.id}`} underline="hover" sx={{ fontWeight: 600 }}>{c.nombre}</Link>
          {empresaId === null ? <Typography component="span" variant="xs">{c.empresa_nombre}</Typography> : null}
        </Stack>
      ),
    },
    { clave: 'correo', encabezado: 'Correo', render: (c) => <Typography component="span" sx={{ overflowWrap: 'anywhere' }}>{c.correo ?? '—'}</Typography> },
    { clave: 'telefono', encabezado: 'Teléfono', render: (c) => c.telefono ?? '—' },
    {
      clave: 'estado', encabezado: 'Estado',
      render: (c) => <Chip size="small" color={c.anonimizado ? 'default' : 'success'} variant={c.anonimizado ? 'outlined' : 'filled'} label={c.anonimizado ? 'Anonimizado' : 'Activo'} />,
    },
  ]

  return (
    <Box>
      <EncabezadoPagina
        titulo="Contactos"
        descripcion="Personas que consultan o compran, por empresa, con su historial y su consentimiento."
        contexto={<ContextoOrganizacionActiva />}
        accion={(
          <Tooltip title={!puedeEditar ? TEXTO_SIN_PERMISO_EDICION : empresaNueva ? '' : 'Elegí una tienda para crear un contacto'}>
            <span>
              <Button variant="contained" onClick={() => setCreando(true)} disabled={!puedeEditar || !empresaNueva}>Nuevo contacto</Button>
            </span>
          </Tooltip>
        )}
      />
      <ContenedorSeccion>
        {cargandoTiendas || errorTiendas || empresas.length > 0 ? (
          <Box sx={{ mb: 2 }}>
            <FiltroEmpresa
              empresas={empresas}
              valor={empresaId}
              onCambiar={(id) => {
                elegirEmpresa(id)
                setPagina(1)
              }}
              cargando={cargandoTiendas}
              hayError={errorTiendas}
              textoAyuda="Cada contacto pertenece a una tienda. Si elegís una empresa en la barra superior, se filtra por esa tienda."
            />
          </Box>
        ) : null}

        <Stack spacing={2}>
          <TextField
            type="search"
            label="Buscar contactos"
            placeholder="Buscar por nombre, correo o teléfono"
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            size="small"
            sx={{ width: 320, maxWidth: '100%' }}
          />
          <Box role="status" aria-live="polite" sx={visuallyHidden}>{isLoading || isError ? '' : textoConteo(total)}</Box>
          {isFetching && !isLoading ? <LinearProgress aria-label="Actualizando contactos" sx={{ height: ALTO_BARRA_CARGA }} /> : null}

          <Box aria-busy={isFetching}>
            {isLoading ? (
              <EstadoCargaPagina />
            ) : isError ? (
              <EstadoError descripcion="No pudimos cargar los contactos." reintentar={() => void refetch()} />
            ) : contactos.length === 0 && pagina === 1 ? (
              hayFiltros ? (
                <EstadoVacio titulo="Sin resultados para el filtro." descripcion="Probá con otro texto o con otra tienda." />
              ) : (
                <EstadoVacio titulo="Todavía no hay contactos." descripcion="Creá uno desde el detalle de una consulta o con «Nuevo contacto»." />
              )
            ) : (
              <>
                <ContenidoAdaptable items={contactos} columnas={columnas} obtenerClave={(c) => c.id} etiquetaTabla="Contactos" />
                <Stack direction="row" justifyContent="flex-end" alignItems="center" useFlexGap flexWrap="wrap">
                  <Typography component="span" variant="s">{textoConteo(total)}</Typography>
                  {contactos.length > 0 ? (
                    <TablePagination
                      component="div"
                      count={total}
                      page={pagina - 1}
                      rowsPerPage={TAMANO_PAGINA_CONTACTOS}
                      rowsPerPageOptions={[TAMANO_PAGINA_CONTACTOS]}
                      onPageChange={(_, nueva) => setPagina(nueva + 1)}
                      labelRowsPerPage="Contactos por página"
                      labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                    />
                  ) : null}
                </Stack>
              </>
            )}
          </Box>
        </Stack>
      </ContenedorSeccion>

      {creando && empresaNueva ? (
        <CrearContactoDialog
          empresaId={empresaNueva.id}
          empresaNombre={empresaNueva.nombre}
          inicial={{ nombre: '', correo: '', telefono: '' }}
          onCerrar={(mensaje) => {
            setCreando(false)
            if (mensaje) setAviso(mensaje)
          }}
          onCreado={(id) => {
            setCreando(false)
            navigate(`/contactos/${id}`)
          }}
        />
      ) : null}

      <Snackbar open={aviso !== null} autoHideDuration={6000} onClose={() => setAviso(null)}>
        <Alert severity="info" onClose={() => setAviso(null)}>{aviso}</Alert>
      </Snackbar>
    </Box>
  )
}
