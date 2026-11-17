-- MSF-620 (épica MSF-585): el rol Depósito edita Stock pero no tiene la sección `categorias`, así que la RLS de
-- `dominio.categorias` le devolvía cero filas y el desplegable de «Toma de inventario» salía vacío.
-- Se agrega una política de LECTURA para quien edita Stock (Administrador, Operador y Depósito en la matriz
-- vigente): ve las categorías de SU organización para poder elegir qué contar. No se abre escritura (alta, cambio y baja
-- de categorías siguen exigiendo la sección `categorias`) ni se amplía la lectura a quien solo ve Stock en
-- `lectura` (Mostrador, Consulta, Administración, Miembro, Técnico: siguen sin ver el árbol).
-- Las políticas de `select` se suman con OR: `categorias_select` (sección `categorias`) no cambia.
-- Migración aditiva. Reversión: `drop policy categorias_select_stock on dominio.categorias;`

create policy categorias_select_stock on dominio.categorias
  for select to authenticated
  using (
    organizacion_id = (select private.organizacion_id())
    and (select private.nivel_seccion('stock')) = 'edicion'
  );
