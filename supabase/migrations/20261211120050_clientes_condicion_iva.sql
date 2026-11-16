-- F-VTA-19 (MSF-230, FR-009): condición frente al IVA del cliente, para la factura interna.
-- Esquema: `public.clientes` (plataforma/CRM genérico, ya existente); sin tabla nueva, la RLS por organización no cambia.
-- Migración aditiva: columna nullable. Reversión documentada (solo antes de que haya datos que importar):
--   alter table public.clientes drop constraint clientes_condicion_iva_largo_ck;
--   alter table public.clientes drop column condicion_iva;
alter table public.clientes
  add column if not exists condicion_iva text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clientes_condicion_iva_largo_ck' and conrelid = 'public.clientes'::regclass
  ) then
    alter table public.clientes
      add constraint clientes_condicion_iva_largo_ck check (length(condicion_iva) <= 60);
  end if;
end $$;

comment on column public.clientes.condicion_iva is
  'Condición frente al IVA (texto libre, ej. «Responsable Inscripto»); la factura interna la imprime si está cargada.';
