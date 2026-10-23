// Validación de la entrada del worker (workers/CONTRATO.md): sin ejecución válida no se toca nada.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Entrada = { ok: true; ejecucionId: string } | { ok: false; stderr: string };

export function validarEntrada(env: Record<string, string | undefined>): Entrada {
  const organizacion = env.ORGANIZACION_ID ?? '';
  const ejecucionId = env.EJECUCION_ID ?? '';
  if (!UUID.test(organizacion) || !UUID.test(ejecucionId)) {
    return { ok: false, stderr: `CONFIGURACION_INVALIDA:${env.CONEXION_ID ?? 'sin-conexion'}` };
  }
  return { ok: true, ejecucionId };
}
