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
