// Saneamiento de texto que va en cabeceras de correo. Módulo aparte de `correo.ts` (que importa
// denomailer desde una URL de Deno) para poder probarlo con `node --test`.

// Quita saltos de línea de lo que va en cabeceras: el nombre de quien escribe viene de datos de usuario.
export const lineaSegura = (valor: string) => valor.replace(/[\r\n]+/g, ' ').trim()
