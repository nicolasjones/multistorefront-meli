# Pestañas de la gestión de la tienda

Cada archivo `*.tsx` de esta carpeta es una pestaña de `/empresas/:id/tienda/:pestana`
(`GestionTienda` las carga con `import.meta.glob`, de forma diferida). El nombre del
archivo es la clave de la ruta: `identidad`, `contenido` y `catalogo`.

Contrato (ver `../pestanas.ts`):

- `export default` un componente que recibe `{ empresaId, empresaNombre }`.
- Con cambios sin guardar, la pestaña llama `useWarnAboutChange().setWarnWhen(true)`; así el
  aviso al cambiar de empresa (Principio VIII) funciona sin que la gestión conozca el formulario.

Cada historia (F-TDA-02 identidad, F-TDA-03 contenido, F-TDA-04 catálogo) aporta la suya.
