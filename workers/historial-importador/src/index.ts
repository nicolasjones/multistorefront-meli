// Entrypoint del worker `historial-importador` (workers/CONTRATO.md). Entrada: ORGANIZACION_ID,
// EJECUCION_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y PG* del servidor. Sale con 0 (éxito),
// 78 (no reintentable) o 1 (falla técnica, el flow reintenta).
import { crearPuertos } from './infra.js';
import { ejecutarDesdeEntorno } from './importar.js';

try {
  const salida = await ejecutarDesdeEntorno(process.env, () => crearPuertos(process.env));
  if (salida.stderr) console.error(salida.stderr);
  process.exitCode = salida.codigo;
} catch {
  // Sin el mensaje original: puede traer rutas o datos de conexión. El flow reintenta.
  console.error('FALLA_TECNICA:historial-importador');
  process.exitCode = 1;
}
