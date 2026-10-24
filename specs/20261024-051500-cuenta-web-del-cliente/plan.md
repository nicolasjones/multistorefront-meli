# Implementation Plan: Clientes y proveedores · Cuenta web del cliente

**Branch**: `epic/MSF-237-clientes-y-proveedores-cuenta-web-del-cl` | **Date**: 2026-10-24 | **Spec**: `specs/20261024-051500-cuenta-web-del-cliente/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Un operador de Clientes crea por invitación la cuenta web de un cliente en una tienda donde está habilitado (ficha, listado y formulario), la suspende o reactiva; el cliente define su contraseña, ingresa a la tienda de esa empresa, recupera su contraseña y, con cuenta activa, ve los precios de su escala (minorista x1; mayorista x1/x5/x10/x50 en la ficha). La cuenta vive en `public.cuentas_cliente`, **no** en `usuarios_organizacion`, y no puede leer nada del panel.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Panel: `pages/clientes/{list,show,create,edit}.tsx` (la columna «Cuenta web» ya existe como placeholder «—» en `list.tsx`; la ficha ya muestra «Habilitado en»). Tienda pública: `pages/tienda-publica/` (resolución por `Host`, rutas por archivo en `rutas/*.tsx`, `lib/tienda*.ts`).
- **Base**: Postgres self-hosted (sin Supabase Cloud). Verificado en el repo: existen `public.clientes` (con `tipo`, `correo`), `public.clientes_empresas`, `public.guardar_empresas_de_cliente`, `public.escala_de_cliente` (`mayorista` ⇒ `por_cantidad`), `private.precio_para(producto, empresa, escala)`, `publico.*_por_dominio`, `private.normalizar_host`, `private.registrar_actividad`. **No existen** `cuentas_cliente`, `invitar-cliente`, `recuperar-clave-cliente`, `acceso_cliente_por_dominio`, `precios_cliente_por_dominio` ni `tipos_cliente`: se crean por migración/función nueva (ver contratos). Última migración: `20261201130000`.
- **Edge Functions**: patrón de `supabase/functions/invitar-miembro` (`handler.ts` con dependencias inyectadas + `index.ts` que cablea los clientes reales; service-role solo en la función).
- **Auth**: `enable_signup=false` (se conserva); correos y plantillas de Auth del template; bloqueo por intentos (Auth Hook) sin cambios. Los dominios de tienda deben estar en las redirecciones permitidas (`additional_redirect_urls`; en STG/PROD el equivalente self-hosted — `config.toml` solo rige en local, ver `docs/acceso-ingreso.md`).
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe (componentes y handlers), Playwright E2E con los dos dominios del seed. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: carga diferida por ruta en la tienda; una sola llamada RPC de precios por página; tarjetas del catálogo sin llamadas extra por producto.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | `cuentas_cliente` con RLS por organización + sección Clientes; la cuenta web sin `organizacion_id()` no lee nada del panel (pgTAP); service-role solo en Edge Functions; `anon` solo ejecuta `recuperar-clave-cliente` (función de borde) y las RPC de acceso existentes. |
| II Especificar primero | Esta spec; cada FR/SC tiene una tarea dueña y una verificación. |
| III Idempotencia/auditoría | Invitar, vincular y cambiar estado son idempotentes; eventos de Actividad con actor, cliente y tienda. |
| IV Despliegues independientes | Sin Compose nuevo; solo `refine` y `supabase`. |
| V Simplicidad | Una tabla nueva, dos Edge Functions, dos funciones públicas; sin infraestructura nueva. |
| VI Panel operable | Estados del kit, teclado, lector de pantalla, 320/768/1440, sin ids visibles, carga diferida por ruta en la tienda. |
| VII Esquemas | `public.cuentas_cliente` (autenticación atada a `clientes`, que está en `public` por excepción documentada); funciones en `publico`/`private`. Re-verificado aquí: coincide con la spec. pgTAP de `anon` y de RLS recorre `public` + `dominio`. |
| VIII Empresa activa | Listado y ficha respetan la empresa activa (FR-017) con test de cambio de empresa; la tienda pública se resuelve por `Host` (sin selector). Fila en la matriz de la spec. |

## Estructura

```text
supabase/
├── migrations/       # 20261204151000 cuentas_cliente (F-CLI-05) ·  20261204151100 rpc + actividad (F-CLI-05)
│                     # 20261204151300 acceso_cliente_por_dominio (F-CLI-05) · 20261205110000 precios_cliente (F-CLI-07)
├── functions/        # invitar-cliente (F-CLI-05) · recuperar-clave-cliente (F-CLI-06)
├── tests/database/   # cuentas_cliente.test.sql · acceso_cliente.test.sql · precios_cliente.test.sql
└── config.toml       # additional_redirect_urls (F-CLI-06)
apps/web/src/
├── components/clientes/   # BloqueTiendas.tsx · BloqueCuentaWeb.tsx (F-CLI-05)
├── lib/                   # cuentasCliente.ts (panel) · tiendaCuenta.ts · tiendaPreciosCliente.ts (tienda)
└── pages/
    ├── clientes/          # show/list/create/edit (F-CLI-05)
    └── tienda-publica/    # rutas/ingresar|definir-contrasena|recuperar-contrasena (F-CLI-06) · ficha/tarjeta (F-CLI-07)
```

## Fases y dependencias

Cada historia es autosuficiente: sus migraciones y tareas dependen solo de su propia historia.

1. **F-CLI-05** (L): tabla + RPC + actividad + acceso por dominio + Edge `invitar-cliente` + ficha/listado/formulario.
2. **F-CLI-06** (S) y **F-CLI-07** (M) en paralelo (archivos y migraciones distintos), ambas sobre la cuenta de F-CLI-05.
3. **Cierre**: documentación, roadmap y gates.

## Riesgos

- **Redirecciones de Auth por dominio de tienda**: self-hosted exige permitir cada dominio; documentar el procedimiento (STG/PROD) en el cierre.
- **Sesión del panel vs. sesión del cliente** en el mismo origen (desarrollo): la tienda usa su propio cliente de Supabase y el guardia del panel rechaza a quien no tiene membresía.
- **Pantallas públicas sin dibujar** (D6) y **fecha límite del 31 de diciembre** para F-CLI-07: anotados en la spec; no se resuelven aquí.
- **Enumeración de cuentas**: respuesta uniforme en recuperar e ingresar; el bloqueo por intentos existente se hereda.
