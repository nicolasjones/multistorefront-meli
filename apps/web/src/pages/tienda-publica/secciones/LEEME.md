# Secciones de la tienda pública

Cada archivo `*.tsx` de esta carpeta es una sección de la página de la tienda
(`PaginaTienda` las carga con `import.meta.glob` y las ordena por `orden`).

Contrato (ver `../PaginaTienda.tsx`):

- `export default` un componente que recibe `{ tienda, host }`.
- `export const orden = <número>` (opcional, menor primero; por defecto 100).

Cada historia de la épica MSF-147 aporta la suya sin tocar un archivo común
(F-TDA-02 `TemaTienda`, F-TDA-03 `BannerHome`/`BarraBienvenida`/`PieTienda`,
F-TDA-10 `EstadoPreparacion` (30), `CategoriasInicio` (40) y `DestacadosInicio` (50), que
reemplaza a la antigua `ProductosTienda`). Solo leen lo que devuelve el esquema `publico`.
