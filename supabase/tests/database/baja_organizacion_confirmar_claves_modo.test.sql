-- Seguridad retroactiva: private.confirmar_claves_diferidas() no debe diferir las restricciones que nacieron
-- `deferrable initially immediate`; solo restaura las `initially deferred`.
begin;

select plan(4);

create table public.padre_modo_tmp (id integer primary key);
create table public.hijo_inmediato_tmp (id integer primary key, padre integer,
  constraint hijo_inmediato_tmp_fk foreign key (padre) references public.padre_modo_tmp (id) deferrable initially immediate);
create table public.hijo_diferido_tmp (id integer primary key, padre integer,
  constraint hijo_diferido_tmp_fk foreign key (padre) references public.padre_modo_tmp (id) deferrable initially deferred);

-- El llamador la había puesto inmediata: la función restaura el modo DECLARADO, no el de la sesión.
set constraints public.hijo_diferido_tmp_fk immediate;
select lives_ok($q$select private.confirmar_claves_diferidas()$q$, 'la confirmación corre sin pendientes');

select throws_ok(
  $q$insert into public.hijo_inmediato_tmp values (1, 999)$q$,
  '23503', null, 'una clave deferrable initially immediate sigue inmediata después de la confirmación');

select lives_ok(
  $q$insert into public.hijo_diferido_tmp values (1, 999)$q$,
  'una clave initially deferred vuelve a diferirse aunque el llamador la hubiera puesto immediate (modo declarado, no el de la sesión)');

select throws_ok(
  $q$select private.confirmar_claves_diferidas()$q$,
  'P0001', 'No se puede borrar: el registro está en uso por otros datos.',
  'con una fila huérfana pendiente la confirmación traduce el error');

select * from finish();
rollback;
