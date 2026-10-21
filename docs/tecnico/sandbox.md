# Sandbox de onboarding

Un entorno local para aprender sin tocar datos reales.

## 1. Levantar

```bash
pnpm install
pnpm dev:supabase   # Postgres/Auth/Storage local
pnpm dev            # panel en http://localhost:5173
```

El seed local crea un superadmin (solo local; ver `supabase/seed.sql`):

- email: `superadmin@local.test`
- password: `Superadmin-Local1!`

## 2. Recorrido de 10 minutos

1. Ingresá con el superadmin.
2. Creá una organización y una empresa/tienda.
3. Creá un cliente y un producto; asigná el producto a la tienda.
4. Cargá stock (entrada) y mirá el historial.
5. Abrí Catálogo, Clientes, Stock y Actividad; probá una búsqueda.
6. Si querés Service técnico, creá un modelo/estado y una reparación.

## 3. Datos de prueba

- Los E2E con sesión siembran su propia organización/empresa/usuarios y limpian al final (`apps/web/e2e/`).
- No uses datos reales ni la service-role key en el navegador.
- Si algo falla, `pnpm dev:supabase` + `supabase db reset` deja el local limpio (solo local).

## 4. Después del sandbox

- Leé [Empezar (técnico)](README.md) y [Onboarding](onboarding.md).
- Para el producto, [Qué es MSF](../producto/README.md).
