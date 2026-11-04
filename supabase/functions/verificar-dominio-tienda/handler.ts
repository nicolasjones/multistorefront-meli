// Lógica de `verificar-dominio-tienda` (F-TDA-05, FR-006, FR-009…FR-012) con dependencias inyectadas
// para probarla sin Deno, DNS ni red (handler.test.ts). `index.ts` solo cablea los clientes reales.
//
// Seguridad: los hostnames salen SIEMPRE de la base (`preparar_verificacion_tienda`), nunca del request;
// la comprobación TLS solo corre con el dominio verificado y se conecta a la IP de la plataforma guardada
// en la base (nunca a una IP resuelta del DNS del usuario, que podría cambiar entre consultas), validando el
// certificado contra el nombre del dominio.

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

type DbError = { message: string; code?: string }
type Resultado<T = unknown> = Promise<{ data: T; error: DbError | null }>

export type Certificado = 'pendiente' | 'activo' | 'error'
export type EstadoRegistro = 'correcto' | 'incorrecto' | 'pendiente'
export type TipoRegistro = 'A' | 'CNAME' | 'TXT'

export type Preparacion = {
  dominio: string
  redireccion: string | null
  token: string
  ip_publica: string
  cname_destino: string
  prefijo_txt: string
}

export type ResultadoRegistro = { tipo: TipoRegistro; nombre: string; estado: EstadoRegistro; valor_encontrado: string | null }

export type Deps = {
  verificarJwt(jwt: string): Promise<{ id: string } | null>
  // deno-lint-ignore no-explicit-any
  caller(jwt: string): { rpc(nombre: string, args: Record<string, unknown>): Resultado<any> }
  // Cliente con service-role: solo para `registrar_verificacion_dns` (exclusivo de service_role).
  admin: { registrar(empresaId: string, dominio: string, redireccion: string | null, resultados: ResultadoRegistro[], certificado: Certificado): Promise<{ error: DbError | null }> }
  // Consultas DNS de un hostname concreto. Sin registros (NXDOMAIN / sin datos) devuelven []; un fallo
  // de red o un servidor DNS caído lanza, y la función responde 502 sin tocar ningún estado guardado.
  dns: {
    resolverA(host: string): Promise<string[]>
    resolverCname(host: string): Promise<string[]>
    resolverTxt(host: string): Promise<string[]>
  }
  // Conexión TLS a la IP de la plataforma validando el certificado del dominio: 'activo' | 'pendiente' (aún sin emitir) | 'error'.
  tls: { comprobar(host: string, ipPlataforma: string): Promise<Certificado> }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sinPuntoFinal = (host: string) => host.trim().toLowerCase().replace(/\.+$/, '')

// Compara el valor esperado con los encontrados (FR-005): sin registros = pendiente; alguno igual =
// correcto; otros valores = incorrecto, con el primero encontrado como ayuda.
export function evaluarRegistro(
  encontrados: string[],
  esperado: string,
  normalizar: (valor: string) => string = (valor) => valor.trim(),
  esRelevante: (valor: string) => boolean = () => true,
): { estado: EstadoRegistro; valor_encontrado: string | null } {
  const relevantes = encontrados.filter(esRelevante)
  if (relevantes.length === 0) return { estado: 'pendiente', valor_encontrado: null }
  if (relevantes.some((valor) => normalizar(valor) === normalizar(esperado))) return { estado: 'correcto', valor_encontrado: null }
  return { estado: 'incorrecto', valor_encontrado: relevantes[0].slice(0, 500) }
}

const rpcError = (error: DbError) => {
  if (error.code === '42501' || error.message === 'sin_permiso') return response({ error: 'sin_permiso' }, 403)
  if (error.message === 'demasiado_pronto') return response({ error: 'demasiado_pronto' }, 429)
  if (error.message === 'sin_dominio') return response({ error: 'sin_dominio' }, 400)
  if (error.code === 'P0002') return response({ error: 'sin_permiso' }, 403)
  return response({ error: 'solicitud_invalida' }, 400)
}

export async function manejar(req: Request, { verificarJwt, caller, admin, dns, tls }: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'solicitud_invalida' }, 405)
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return response({ error: 'no_autenticado' }, 401)
  const usuario = await verificarJwt(jwt)
  if (!usuario) return response({ error: 'no_autenticado' }, 401)

  const body = await req.json().catch(() => null) as { empresa_id?: unknown } | null
  if (typeof body?.empresa_id !== 'string' || !UUID.test(body.empresa_id)) return response({ error: 'solicitud_invalida' }, 400)
  const empresaId = body.empresa_id

  // Permiso, pertenencia a la organización, límite de 10 s y hostnames guardados: todo en la base.
  const { data, error } = await caller(jwt).rpc('preparar_verificacion_tienda', { p_empresa_id: empresaId })
  if (error) return rpcError(error)
  const prep = data as Preparacion
  const dominio = sinPuntoFinal(prep.dominio)
  const redireccion = prep.redireccion ? sinPuntoFinal(prep.redireccion) : null

  const resultados: ResultadoRegistro[] = []
  try {
    const [direcciones, textos, cnames] = await Promise.all([
      dns.resolverA(dominio),
      dns.resolverTxt(`_verif.${dominio}`),
      redireccion ? dns.resolverCname(redireccion) : Promise.resolve([] as string[]),
    ])
    resultados.push({ tipo: 'A', nombre: '@', ...evaluarRegistro(direcciones, prep.ip_publica) })
    resultados.push({
      tipo: 'TXT',
      nombre: '_verif',
      // Solo cuentan los TXT de esta verificación (con el prefijo): otros TXT del dominio no son «incorrectos».
      ...evaluarRegistro(textos, `${prep.prefijo_txt}=${prep.token}`, (valor) => valor.trim(), (valor) => valor.trim().startsWith(`${prep.prefijo_txt}=`)),
    })
    if (redireccion) {
      const etiqueta = redireccion.endsWith(`.${dominio}`) ? redireccion.slice(0, -(dominio.length + 1)) : redireccion
      resultados.push({ tipo: 'CNAME', nombre: etiqueta, ...evaluarRegistro(cnames, prep.cname_destino, sinPuntoFinal) })
    }
  } catch (e) {
    console.error('verificar-dominio-tienda: DNS no disponible', e instanceof Error ? e.message : e)
    return response({ error: 'dns_no_disponible' }, 502)
  }

  const correcto = (tipo: TipoRegistro) => resultados.find((registro) => registro.tipo === tipo)?.estado === 'correcto'
  const dominioVerificado = correcto('A') && correcto('TXT') && (!redireccion || correcto('CNAME'))

  // FR-012: nunca se conecta a un host cuyo A no apunte a la plataforma ni con el dominio sin verificar.
  let certificado: Certificado = 'pendiente'
  if (dominioVerificado && correcto('A')) {
    try {
      certificado = await tls.comprobar(dominio, prep.ip_publica)
    } catch (e) {
      console.error('verificar-dominio-tienda: comprobación TLS fallida', e instanceof Error ? e.message : e)
      certificado = 'pendiente'
    }
  }

  const { error: errorRegistro } = await admin.registrar(empresaId, dominio, redireccion, resultados, certificado)
  if (errorRegistro) {
    console.error('verificar-dominio-tienda: no se pudo registrar el resultado', errorRegistro.message)
    return response({ error: 'solicitud_invalida' }, 400)
  }

  return response({
    dominio_verificado: dominioVerificado,
    certificado,
    registros: resultados.map(({ tipo, nombre, estado }) => ({ tipo, nombre, estado })),
  })
}

// Una conexión TLS que falla por el certificado (inválido, vencido, otro nombre) es «error»; si no hay
// certificado todavía o el puerto no responde, es «pendiente» (aún no emitido). Aislada y reemplazable por
// el estado que informe el proveedor del SSL (D1).
export function clasificarFalloTls(mensaje: string): Certificado {
  return /certificate|cert|unknownissuer|expired|notvalid|invalid peer|hostname mismatch|self.signed/i.test(mensaje) ? 'error' : 'pendiente'
}
