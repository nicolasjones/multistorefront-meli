// Saneamiento de texto que va en cabeceras de correo. Módulo aparte de `correo.ts` (que importa
// denomailer desde una URL de Deno) para poder probarlo con `node --test`.

// Controles C0/C1, U+2028/2029 y caracteres invisibles o de dirección (se conservan ZWNJ/ZWJ, U+200C/D: son parte de
// nombres en persa, hindi y de emojis compuestos). Contenido de una clase de regex: lo usan `lineaSegura` y la
// validación del destinatario (`CORREO_VALIDO`), para que lo que `lineaSegura` volvería un espacio no pase por dirección.
export const CARACTERES_NO_PERMITIDOS =
  '\\u0000-\\u001F\\u007F-\\u009F\\u2028\\u2029\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF'

// Quita de lo que va en cabeceras los saltos de línea y esos caracteres: el nombre de quien escribe viene de datos de usuario.
const NO_PERMITIDOS = new RegExp(`[${CARACTERES_NO_PERMITIDOS}]+`, 'g')
export const lineaSegura = (valor: string) => valor.replace(NO_PERMITIDOS, ' ').trim()
