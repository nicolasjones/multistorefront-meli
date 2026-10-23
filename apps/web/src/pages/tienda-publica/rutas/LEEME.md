# Rutas de la tienda pública

Cada archivo `*.tsx` de esta carpeta es una ruta del front público; `EnrutadorTienda` las registra con
`import.meta.glob` y las carga de forma diferida (`lazy`). Cada historia aporta las suyas sin tocar un
archivo común. Los `*.test.tsx` quedan excluidos del glob (no son rutas); ponelos fuera de esta carpeta o con ese sufijo.

Contrato:

- `export default` un componente. Recibe todo por el contexto del layout: `useContextoTienda()`
  (`{ tienda, host, categorias }`).
- La ruta sale del **nombre del archivo** (`rutaDeArchivo` en `../EnrutadorTienda.tsx`):
  - `inicio.tsx` → `/`
  - `<nombre>.tsx` → `/<nombre>` y `/<nombre>/:<nombre>Id` (p. ej. `categoria.tsx` →
    `/categoria/:categoriaId`; `producto.tsx` → `/producto/:productoId`; `catalogo.tsx` → `/catalogo`).
    El componente decide qué hacer con el parámetro que no use (si sobra, puede mostrar
    `PaginaNoEncontrada`).
- Cualquier otra URL cae en `*` → `PaginaNoEncontrada`.
