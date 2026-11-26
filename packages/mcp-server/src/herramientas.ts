// Contrato: specs/servidor-mcp-generico/contracts/protocolo-mcp.md
//
// Listado dinámico de herramientas MCP por conexión: solo las funcionalidades
// habilitadas para la organización de la credencial Y expuestas a nivel
// plataforma aparecen como herramienta — nunca una lista completa con
// algunas marcadas como no disponibles (edge case de la spec).
//
// Decisión de seguridad reforzada (hallazgo del coordinador, 2026-10-03):
// no hay un "usuario logueado" ni JWT de sesión para una credencial MCP
// (a diferencia de Chat IA, que usa asUser + RLS) — el servidor corre con
// service_role. Un `.eq('organizacion_id', ...)` armado en TypeScript NO es
// una garantía real: alcanza con que una lectura nueva se agregue sin ese
// filtro para cruzar datos entre organizaciones, sin que la base lo
// detecte. Por eso toda lectura de datos de negocio pasa exclusivamente
// por `private.mcp_leer_fila` (SQL, security definer) — el WHERE de
// organización se arma DENTRO de esa función, no acá. Esta función de
// herramientas.ts no debe volver a tocar una tabla de negocio directo
// (`.from(vista)...`) nunca más.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { sanitizarDato } from '@platform/ia'
import type { ConexionAutenticada } from './autenticacion.js'

// sanitizarDato filtra por allowlist exacta (includes(), no glob) — acá la
// vista ya es una fuente curada y registrada a mano por un superadmin
// (fuentes_mcp), así que el allowlist real es "todas las columnas que la
// fila efectivamente tiene"; lo que sanitizarDato sigue aportando es el
// filtro de nombres con pinta de secreto (password/token/cookie/...) sobre
// esas columnas, que si no se usara acá quedaría sin aplicar.
function permitidosDesdeFilas(filas: unknown[]): string[] {
  const primera = filas[0]
  return primera && typeof primera === 'object' ? Object.keys(primera) : []
}

// Nombre de herramienta válido para MCP (letras, números, `_`, `-`, `.`).
function segmento(texto: string): string {
  return texto.replace(/[^A-Za-z0-9_.-]/g, '_')
}

// `fuentes_mcp` y `acciones_mcp` permiten varias filas por feature (PK (feature_id, vista) / (feature_id, rpc)): con
// un nombre por feature, el segundo `registerTool` lanzaba «already registered» y tumbaba el `initialize` de todos.
// Una feature con una sola fila conserva `<prefijo>_<feature>`; con varias, cada fila lleva su discriminador.
export function nombreHerramienta(prefijo: 'leer' | 'ejecutar', featureId: string, discriminador: string, filasDeLaFeature: number): string {
  return filasDeLaFeature > 1 ? `${prefijo}_${segmento(featureId)}_${segmento(discriminador)}` : `${prefijo}_${segmento(featureId)}`
}

function contar(filas: Array<{ feature_id: string }>): Map<string, number> {
  const conteo = new Map<string, number>()
  for (const fila of filas) conteo.set(fila.feature_id, (conteo.get(fila.feature_id) ?? 0) + 1)
  return conteo
}

// Clave que designa a la organización en los parámetros de una acción (`organizacion_id`, `organizacionId`,
// `p_organizacion_id`, `org_id`, `organization_id`…): se compara sin mayúsculas ni separadores.
export function esClaveDeOrganizacion(clave: string): boolean {
  // Criterio histórico (sufijo `organizacion_id`: `proveedor_organizacion_id`, `target_organizacion_id`…) O el normalizado.
  if (/organizacion_id$/i.test(clave)) return true
  return /^(p)?(organizacion|organization|org)(id|uuid)?$/.test(clave.toLowerCase().replace(/[^a-z0-9]/g, ''))
}

export async function registrarHerramientas(server: McpServer, conexion: ConexionAutenticada): Promise<void> {
  const { admin, organizacionId } = conexion

  const { data: fuentesCrudas } = await admin.from('fuentes_mcp').select('feature_id, vista, descripcion')
  const fuentes = [...(fuentesCrudas ?? [])].sort((a, b) => `${a.feature_id}/${a.vista}`.localeCompare(`${b.feature_id}/${b.vista}`))
  const filasPorFuente = contar(fuentes)
  const registradas = new Set<string>()
  for (const fuente of fuentes) {
    const { data: puedeLeer } = await admin.rpc('puede_mcp_leer_funcionalidad', { p_feature_id: fuente.feature_id, p_organizacion_id: organizacionId })
    if (!puedeLeer) continue

    const nombre = nombreHerramienta('leer', fuente.feature_id, fuente.vista, filasPorFuente.get(fuente.feature_id) ?? 1)
    if (registradas.has(nombre)) {
      console.warn('mcp: nombre de herramienta repetido tras normalizar, se omite', nombre)
      continue
    }
    registradas.add(nombre)
    server.registerTool(
      nombre,
      {
        title: fuente.descripcion ?? `Leer ${fuente.feature_id}`,
        description: fuente.descripcion ?? `Lee datos de ${fuente.feature_id}.`,
        inputSchema: { filtros: z.record(z.string(), z.union([z.string(), z.number()])).optional() },
      },
      async ({ filtros }) => {
        // Única vía de lectura de datos de negocio: el WHERE de
        // organización se arma dentro de private.mcp_leer_fila (SQL), no
        // acá. filtros viaja tal cual al campo jsonb p_filtros — la función
        // los agrega con format(%I)/format(%L), nunca concatenación directa.
        const { data, error } = await admin.rpc('mcp_leer_fila', {
          p_organizacion_id: organizacionId,
          p_feature_id: fuente.feature_id,
          p_filtros: filtros ?? {},
        })
        if (error) return { content: [{ type: 'text', text: 'ERROR_AL_LEER' }], isError: true }
        const filas = (data ?? []) as unknown[]
        return { content: [{ type: 'text', text: JSON.stringify(sanitizarDato(filas, permitidosDesdeFilas(filas))) }] }
      },
    )
  }

  const { credencialId } = conexion

  const { data: accionesCrudas } = await admin.from('acciones_mcp').select('feature_id, rpc, descripcion')
  const acciones = [...(accionesCrudas ?? [])].sort((a, b) => `${a.feature_id}/${a.rpc}`.localeCompare(`${b.feature_id}/${b.rpc}`))
  const filasPorAccion = contar(acciones)
  for (const accion of acciones) {
    const { data: puedeEjecutar } = await admin.rpc('puede_mcp_ejecutar_funcionalidad', { p_feature_id: accion.feature_id, p_organizacion_id: organizacionId })
    if (!puedeEjecutar) continue

    const nombre = nombreHerramienta('ejecutar', accion.feature_id, accion.rpc, filasPorAccion.get(accion.feature_id) ?? 1)
    if (registradas.has(nombre)) {
      console.warn('mcp: nombre de herramienta repetido tras normalizar, se omite', nombre)
      continue
    }
    registradas.add(nombre)
    server.registerTool(
      nombre,
      {
        title: accion.descripcion ?? `Ejecutar ${accion.feature_id}`,
        description: accion.descripcion ?? `Ejecuta una acción sobre ${accion.feature_id}.`,
        inputSchema: { parametros: z.record(z.string(), z.unknown()).optional() },
      },
      async ({ parametros }) => {
        // Dos pasos, no uno: iniciar_ejecucion_mcp revalida la capacidad y
        // pone el candado de concurrencia (TOCTOU, FR-013/FR-014); recién
        // después se invoca la RPC real de la funcionalidad, con su propia
        // firma tipada — supabase-js resuelve los parámetros nombrados
        // contra esa firma, igual que PostgREST (research.md R4, no hay
        // forma genérica de invocar una firma arbitraria por SQL dinámico).
        // El vencimiento de ejecuciones `en_curso` abandonadas (10 minutos) vive dentro de iniciar_ejecucion_mcp (SQL).
        const { data: ejecucionId, error: inicioError } = await admin.rpc('iniciar_ejecucion_mcp', {
          p_credencial_id: credencialId, p_feature_id: accion.feature_id,
        })
        if (inicioError || !ejecucionId) {
          // Sin `message` de la base (nombre de índices, funciones): el cliente externo solo ve un texto fijo.
          if (inicioError) console.error('mcp: no se pudo iniciar la ejecución', inicioError.message)
          const enCurso = inicioError?.code === '23505'
          return { content: [{ type: 'text', text: enCurso ? 'EJECUCION_EN_CURSO' : 'EJECUCION_NO_DISPONIBLE' }], isError: true }
        }

        // El cliente MCP externo no decide la organización, nunca: si sus
        // parametros incluyen una clave con pinta de organización, se pisa
        // acá con el valor resuelto por la credencial, sin importar qué
        // mandó. No se inyecta si la RPC real no la pide (evitaría romper
        // firmas que no la tienen) — esto es un override, no una garantía
        // tan fuerte como mcp_leer_fila: cada RPC registrada en
        // acciones_mcp sigue siendo responsable de resolver/validar su
        // propia organización, no de confiar en cualquier valor recibido
        // (constraint documentado en research.md para quien registre una
        // funcionalidad ejecutable nueva).
        const parametrosSeguros = { ...(parametros ?? {}) }
        for (const clave of Object.keys(parametrosSeguros)) {
          if (esClaveDeOrganizacion(clave)) parametrosSeguros[clave] = organizacionId
        }

        const { data, error } = await admin.rpc(accion.rpc, parametrosSeguros)

        // El motivo completo queda en la auditoría (solo superadmin); al cliente no se le devuelve.
        const { error: finalizarError } = await admin.rpc('finalizar_ejecucion_mcp', {
          p_ejecucion_id: ejecucionId,
          p_estado: error ? 'fallida' : 'completada',
          p_motivo_error: error?.message ?? null,
        })
        // Si no se puede cerrar, la fila queda `en_curso` hasta que iniciar_ejecucion_mcp la venza: se deja rastro.
        if (finalizarError) console.error('mcp: no se pudo finalizar la ejecución', ejecucionId, finalizarError.message)

        if (error) {
          console.error('mcp: la acción falló', accion.rpc, error.message)
          return { content: [{ type: 'text', text: 'ERROR_AL_EJECUTAR' }], isError: true }
        }
        return { content: [{ type: 'text', text: JSON.stringify(data) }] }
      },
    )
  }
}
