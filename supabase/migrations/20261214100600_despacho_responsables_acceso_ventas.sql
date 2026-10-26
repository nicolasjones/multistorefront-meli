-- F-VTA-15 (MSF-152, épica MSF-135, spec 20261024-130000-ventas-despacho-y-faltantes, FR-009, FR-004, FR-005,
-- FR-006): los responsables del despacho tienen que tener acceso a Ventas en la empresa del comprobante.
--
-- Devolución del Revisor (seguridad): el desplegable de responsables podía ofrecer a alguien que no tiene
-- acceso a la sección en la que va a trabajar. La regla del modelo es explícita — «Responsables (armó, controló,
-- entregó): usuarios del equipo con acceso a Ventas en la empresa del comprobante» (spec, *Modelo y supuestos*)
-- — así que la elegibilidad se completa con el nivel de Ventas del rol del responsable en esa empresa, el mismo
-- patrón que usa `responsables_consultas` (MSF-186) para la sección Consultas.
--
-- Por qué la sección es Ventas y no Consultas: el despacho actúa sobre la factura (sección Ventas) y la
-- matriz inicial deja Consultas en `ninguno` para Depósito — el rol que arma y controla (FR-004, FR-005) —;
-- exigir Consultas dejaría a la factura sin nadie que la arme. Un responsable de Consultas (consulta) tampoco
-- tiene la acción `despachar` (FR-008), así que nunca es elegible.
--
-- La comprobación vive en `private.responsable_despacho_habilitado`, que usan las dos puertas: el desplegable
-- (`public.listar_responsables_despacho`) y la autoridad (`public.cambiar_estado_despacho`). Así, quien no tiene
-- Ventas en la empresa no aparece en el desplegable y tampoco se puede registrar como responsable.
--
-- Esquema (Principio VII): sin tablas nuevas; solo se redefine la función interna. `security definer`,
-- `set search_path = ''` y sin `grant` a `authenticated` (solo la llaman las RPC de despacho).
--
-- Migración aditiva. Reversión (migración posterior): reaplicar la definición de
-- 20261214100400_despacho_responsables.sql (la misma función sin el nivel de Ventas):
--   create or replace function private.responsable_despacho_habilitado(uuid, text, text) ... ;
create or replace function private.responsable_despacho_habilitado(
  p_organizacion uuid,
  p_rol_id text,
  p_funcion text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (case
      -- Armar y controlar: Depósito o Administrador de la empresa.
      when p_funcion in ('armar', 'controlar') then p_rol_id in ('deposito', 'administrador')
      -- Entregar: quien tenga la acción `despachar` en Ventas.
      when p_funcion = 'entregar' then private.accion_de_rol(p_organizacion, p_rol_id, 'ventas', 'despachar')
      else false
    end)
    -- Y, siempre, tener acceso a Ventas en esa empresa: sin Ventas no se ofrece ni se acepta a la persona.
    and private.nivel_de_rol(p_organizacion, p_rol_id, 'ventas') in ('lectura', 'edicion');
$$;

comment on function private.responsable_despacho_habilitado(uuid, text, text) is
  'true si el rol puede armar, controlar o entregar el despacho de una factura (F-VTA-15). Armar y controlar: Depósito o Administrador. Entregar: rol con la acción `despachar` en Ventas. En todos los casos, el rol tiene que tener Ventas al menos en lectura en la empresa: sin acceso a la sección no se ofrece ni se acepta a la persona.';

revoke execute on function private.responsable_despacho_habilitado(uuid, text, text) from public, anon, authenticated;
