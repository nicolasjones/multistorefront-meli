// Formato texto de COPY ... FROM STDIN para la clave del proveedor de IA (MSF-871). Sin dependencias ni E/S: se prueba sin Postgres.

// Escapa la barra invertida y los saltos/tabs: la clave llega idéntica, no puede cerrar el COPY (`\.` queda `\\.`) ni abrir filas o columnas.
export function escaparCopy(clave) {
  return clave.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

// Oculta la clave en un mensaje de error en su forma cruda y en la escapada que psql imprime en el CONTEXT del COPY.
export function ocultarClave(mensaje, clave) {
  return [escaparCopy(clave), clave]
    .filter((forma) => forma.length > 0)
    .reduce((texto, forma) => texto.replaceAll(forma, '[clave omitida]'), mensaje);
}

// Una clave muy corta haría que `ocultarClave` redacte fragmentos comunes del mensaje (con 'a' ocultaría todas las 'a').
// Se rechaza antes de usarla; el mensaje NUNCA incluye la clave ni su longitud exacta.
export const LARGO_MINIMO_CLAVE = 8;
export function validarLargoClave(clave) {
  if (clave.length < LARGO_MINIMO_CLAVE) {
    throw new Error(`IA_PROVEEDOR_CLAVE es demasiado corta: debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`);
  }
}
