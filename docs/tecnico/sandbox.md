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

## 2. Un clic: datos demo

Con el stack local levantado:

```bash
eval "$(supabase status -o env | sed 's/^/export /')"
export SUPABASE_URL="$API_URL"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

pnpm demo:seed            # crea/actualiza el demo
pnpm demo:seed -- --dry-run
```

Crea (idempotente):

- Organización **Demo MSF** y empresa **Tienda Demo**.
- Usuario **demo@local.test / Demo-Local1!** (Administrador).
- 3 clientes, 3 productos y stock inicial 10 en `DEMO-A`.

Solo corre contra un Supabase **local**; si la URL no es `localhost/127.0.0.1/host.docker.internal`, aborta.

## 3. Recorrido de 10 minutos

1. Ingresá con el superadmin.
2. Creá una organización y una empresa/tienda.
3. Creá un cliente y un producto; asigná el producto a la tienda.
4. Cargá stock (entrada) y mirá el historial.
5. Abrí Catálogo, Clientes, Stock y Actividad; probá una búsqueda.
6. Si querés Service técnico, creá un modelo/estado y una reparación.

## 4. Datos de prueba

- Los E2E con sesión siembran su propia organización/empresa/usuarios y limpian al final (`apps/web/e2e/`).
- No uses datos reales ni la service-role key en el navegador.
- Si algo falla, `pnpm dev:supabase` + `supabase db reset` deja el local limpio (solo local).

## 5. Después del sandbox

- Leé [Empezar (técnico)](README.md) y [Onboarding](onboarding.md).
- Para el producto, [Qué es MSF](../producto/README.md).
