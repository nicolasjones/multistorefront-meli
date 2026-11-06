# Pestañas de la gestión de la tienda

Cada archivo `*.tsx` de esta carpeta es una pestaña de `/empresas/:id/tienda/:pestana`
(`GestionTienda` las carga con `import.meta.glob`, de forma diferida). El nombre del
archivo es la clave de la ruta: `identidad`, `contenido`, `catalogo` y `publicacion`.

Contrato (ver `../pestanas.ts`):

- `export default` un componente que recibe `{ empresaId, empresaNombre }`.
- Con cambios sin guardar, la pestaña llama `useWarnAboutChange().setWarnWhen(true)`; así el
  aviso al cambiar de empresa (Principio VIII) funciona sin que la gestión conozca el formulario.

Cada historia (F-TDA-02 identidad, F-TDA-03 contenido, F-TDA-04 catálogo) aporta la suya.

La pestaña `publicacion` («Dominio y publicación», F-TDA-05/06/07) compone sus secciones desde
`pestanas/publicacion/*.tsx`: cada archivo exporta por defecto el componente de la sección y un
`orden` numérico (`Dominio` = 10); así cada historia agrega su archivo sin editar los de otra.
