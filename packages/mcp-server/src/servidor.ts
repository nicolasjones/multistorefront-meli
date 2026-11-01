// Contrato: specs/servidor-mcp-generico/contracts/protocolo-mcp.md
//
// Bootstrap del servidor MCP — modo CON sesión (sessionIdGenerator:
// randomUUID, no undefined). Encontrado probando con un cliente MCP real
// (T029, SDK oficial + @modelcontextprotocol/inspector): un McpServer nuevo
// por cada solicitud HTTP —lo que decía "research.md R4" antes de esta
// corrección— no funciona con ningún cliente real, porque el protocolo
// exige un handshake `initialize` antes de cualquier otro método
// (`tools/list`, etc.), y ese handshake queda asociado al McpServer que lo
// recibió — un server nuevo en la siguiente solicitud nunca lo vio.
// "Stateless" en el SDK significa "sin session ID en los headers", no "un
// server nuevo por request": el par transporte+server debe sobrevivir
// mientras dura la conexión lógica del cliente (sesión), no la solicitud
// HTTP individual.
//
// Sin Express: el transporte del SDK (StreamableHTTPServerTransport) arma
// su propio Request web-standard internamente vía @hono/node-server,
// leyendo el `req` de Node directo. Probado en vivo (T029): con Express de
// por medio, `onsessioninitialized` nunca disparaba y el header
// `mcp-session-id` nunca volvía en la respuesta — sin ningún error
// visible, incluso con `initialize` respondiendo bien — mientras que el
// mismo transporte sobre `http.createServer` crudo funciona correctamente
// (confirmado con un cliente MCP real: sessionId se recibe y `tools/list`
// funciona). No se identificó la causa exacta del lado de Express/Hono;
// se optó por el servidor HTTP nativo en vez de seguir ese rastro, ya que
// es el patrón que la propia documentación del SDK ejemplifica.
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { crearClienteAdmin, autenticarConexion, revalidarConexion, type ConexionAutenticada } from './autenticacion.js'
import { registrarHerramientas } from './herramientas.js'

const PUERTO = Number(process.env.MCP_SERVER_PORT ?? 8787)
const SESSION_HEADER = 'mcp-session-id'

type Sesion = {
  transport: StreamableHTTPServerTransport
  server: McpServer
  conexion: ConexionAutenticada
  ultimoUso: number
}

// Una sesión sin solicitudes durante este tiempo se cierra y se borra del mapa.
const SESION_INACTIVA_MS = Number(process.env.MCP_SESSION_IDLE_MS ?? 30 * 60 * 1000)

function bearer(authorization: string | undefined): string | undefined {
  return (authorization ?? '').replace(/^Bearer\s+/i, '') || undefined
}

export function crearServidorHttp(adminInyectado?: SupabaseClient): Server {
  const admin = adminInyectado ?? crearClienteAdmin()
  const sesiones = new Map<string, Sesion>()

  async function cerrarSesion(id: string, sesion: Sesion): Promise<void> {
    sesiones.delete(id)
    await sesion.transport.close().catch(() => undefined)
  }

  const barrido = setInterval(() => {
    const limite = Date.now() - SESION_INACTIVA_MS
    for (const [id, sesion] of sesiones) {
      if (sesion.ultimoUso < limite) void cerrarSesion(id, sesion)
    }
  }, Math.max(1000, Math.min(SESION_INACTIVA_MS, 60_000)))
  barrido.unref()

  const http = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end()
      return
    }

    const sessionId = req.headers[SESSION_HEADER] as string | undefined
    const sesionExistente = sessionId ? sesiones.get(sessionId) : undefined

    // Toda solicitud de una sesión existente (POST o DELETE) revalida la
    // credencial: una revocación corta la siguiente llamada (MSF-677).
    if (sesionExistente && (req.method === 'POST' || req.method === 'DELETE')) {
      const vigente = await revalidarConexion(admin, bearer(req.headers.authorization), sesionExistente.conexion)
      if (!vigente) {
        await cerrarSesion(sessionId as string, sesionExistente)
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No autorizado: credencial inválida o revocada.' }))
        return
      }
      sesionExistente.ultimoUso = Date.now()
    }

    if (req.method === 'DELETE') {
      // Terminación explícita de sesión (convención del transporte
      // Streamable HTTP) — sin esto, una sesión cerrada por el cliente
      // queda viva en el mapa hasta que el proceso se reinicie.
      if (!sesionExistente) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Sesión inexistente.' }))
        return
      }
      await sesionExistente.transport.handleRequest(req, res)
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }

    if (sesionExistente) {
      await sesionExistente.transport.handleRequest(req, res)
      return
    }

    // Sin sesión existente: esta solicitud debe ser el `initialize` de una
    // conexión nueva — autenticar con la credencial de ESTA solicitud.
    const token = bearer(req.headers.authorization)
    const conexion = await autenticarConexion(admin, token)
    if (!conexion) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'No autorizado: credencial inválida o revocada.' }))
      return
    }

    const server = new McpServer({ name: process.env.MCP_SERVER_NAME ?? 'platform-mcp', version: '0.0.0' })
    await registrarHerramientas(server, conexion)

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { sesiones.set(id, { transport, server, conexion, ultimoUso: Date.now() }) },
      onsessionclosed: (id) => { sesiones.delete(id) },
    })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })
  http.on('close', () => clearInterval(barrido))
  return http
}

if (process.env.NODE_ENV !== 'test') {
  crearServidorHttp().listen(PUERTO, () => {
    console.log(`Servidor MCP escuchando en :${PUERTO}`)
  })
}
