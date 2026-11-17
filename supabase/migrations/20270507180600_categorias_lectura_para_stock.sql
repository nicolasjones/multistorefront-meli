-- MSF-620 (lote 32, MSF-647): el rol Depósito ve las categorías en «Toma de inventario».
--
-- Causa (RLS, no UI): la pantalla arma su selector leyendo `dominio.categorias`, y `categorias_select` exige la sección
-- `categorias` en lectura o edición. Depósito tiene `categorias` en `ninguno` y `stock` en `edicion` (matriz inicial de
-- 20261020130100), así que el selector llegaba vacío aunque la persona sí puede contar stock.
--
-- Arreglo: una política `select` ADICIONAL (las políticas permisivas se suman) para quien tiene la sección `stock` en
-- lectura o edición, siempre dentro de su organización. Solo lectura: nadie gana permiso de escritura sobre categorías
-- (insert/update/delete siguen exigiendo la sección `categorias` en edición). Se exponen nombres y jerarquía de
-- categorías de SU organización, que ya ve en los productos que cuenta.
--
-- Migración aditiva. Reversión: `drop policy categorias_select_stock on dominio.categorias;`

create policy categorias_select_stock on dominio.categorias
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) in ('lectura', 'edicion')
  );
