// Saneamiento de texto que va en cabeceras de correo. Módulo aparte de `correo.ts` (que importa
// denomailer desde una URL de Deno) para poder probarlo con `node --test`.

// Quita de lo que va en cabeceras los saltos de línea, U+2028/2029, los controles C0/C1 y los caracteres
// invisibles o de dirección (se conservan ZWNJ/ZWJ, U+200C/D: son parte de nombres en persa, hindi y de emojis compuestos): el nombre de quien escribe viene de datos de usuario.
// eslint-disable-next-line no-control-regex
const NO_PERMITIDOS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]+/g
export const lineaSegura = (valor: string) => valor.replace(NO_PERMITIDOS, ' ').trim()
