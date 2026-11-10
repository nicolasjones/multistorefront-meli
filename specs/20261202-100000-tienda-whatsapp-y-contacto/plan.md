# Implementation Plan: Tiendas online · Tienda WhatsApp y contacto

**Branch**: `epic/MSF-212-tiendas-online-tienda-whatsapp-y-contact` | **Date**: 2026-10-24 | **Spec**: `specs/20261202-100000-tienda-whatsapp-y-contacto/spec.md`

**Delivery scope**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

El visitante de la tienda de una empresa (resuelta por dominio desde MSF-147) puede (F-TDA-14) abrir WhatsApp con un mensaje armado desde la ficha de un producto o (F-TDA-16) enviar un formulario de contacto. Ambas consultas se entregan a la bandeja de Consultas y ventas (MSF-122) por **un único adaptador** hacia su interfaz de entrada. El anónimo solo toca funciones de `publico`; el límite de 5 envíos por hora por visitante y empresa y la idempotencia viven en una tabla de control mínima (`dominio.tienda_envios`). F-TDA-16 va primero porque trae la tabla, el límite, el adaptador y los datos de contacto que F-TDA-14 reutiliza.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Front público en `apps/web/src/pages/tienda-publica/`: ya existen `EnrutadorTienda.tsx` (rutas por archivo en `rutas/*.tsx`), `layout/` (`LayoutTienda`, `MenuCategorias`, `PieCategorias`), `ficha/`, `rutas/producto.tsx`, `PaginaNoEncontrada.tsx` y `lib/tiendaFicha.ts`. Se agregan `rutas/contacto.tsx`, `contacto/`, `whatsapp/`, `lib/tiendaContacto.ts`, `lib/whatsapp.ts`. Ninguna historia edita un archivo que la otra también edite (F-TDA-16 toca `layout/MenuCategorias.tsx`, `layout/PieCategorias.tsx` y `pages/empresas/edit.tsx`; F-TDA-14 toca `rutas/producto.tsx` y `ficha/DatosProducto.tsx`).
- **Base**: Postgres self-hosted. Verificado en el repo: `dominio.empresas` (`whatsapp`, `correo`, `instagram`, `direccion`, `activa`; **sin `horarios`**), `dominio.tiendas`, `private.normalizar_host`, `private.catalogo_tienda_efectivo` (visibilidad efectiva), `publico.producto_por_dominio`. **No existen** tablas ni funciones de consultas (MSF-122 aún no está en la rama): se declara la dependencia y se aísla en `private.entregar_a_bandeja` (D4); la primera tarea de F-TDA-16 confirma su firma real antes de escribir el adaptador.
- **Visitante**: la IP del primer salto de `X-Forwarded-For` llega a la función por `current_setting('request.headers', true)`; se guarda solo su hash (D6).
- **Testing**: pgTAP (`supabase/tests/database/`), Vitest + axe, Playwright E2E (`apps/web/e2e/`) con los dos dominios del seed y la bandeja de MSF-122. `pnpm test` requiere `pnpm dev:supabase`.
- **Rendimiento**: carga diferida de `/contacto` por ruta y del diálogo de WhatsApp al abrirlo; una sola llamada RPC por acción.

## Constitution Check

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Tabla nueva con RLS por organización y sin privilegios de API; el anónimo solo ejecuta funciones de `publico` que filtran por el `host` y `empresa.activa`; sin service-role en el navegador; la IP no se guarda. |
| II Especificar primero | Esta spec; cada FR/SC tiene una tarea dueña y una verificación. |
| III Idempotencia/auditoría | `clave_envio` única por empresa: reintentos y dobles clics no duplican; `tienda_envios` registra origen, visitante (hash) y `creado_en`; la falla de entrega revierte el envío. |
| IV Despliegues independientes | Sin Compose nuevo; solo `refine` y `supabase`. |
| V Simplicidad | Sin infraestructura nueva (la poda de filas viejas va dentro de la misma función, sin cron). |
| VI Panel operable | Front público: estados del kit, teclado, lector de pantalla, 320/768/1440, carga diferida. Campo nuevo en Empresas con el patrón existente. |
| VII Esquemas | `dominio.tienda_envios` y `dominio.empresas.horarios` en **`dominio`** (producto Tiendas online / empresa); funciones en `publico`/`private`; nada en `public`. Re-verificado aquí: coincide con la spec. pgTAP de aislamiento recorre `public` + `dominio`. |
| VIII Empresa activa | Pantallas públicas: no aplica (se resuelve por `Host`; declarado en la matriz y verificado con el E2E de dos tiendas). Campo de Empresas: usa la empresa activa del formulario existente. |
| Documentación | `docs/tiendas-online.md` (sección nueva) en el cierre. |

Regla del proyecto «anon solo ejecuta las RPC de acceso»: se respeta (las funciones viven en `publico`, no en `public`); el pgTAP existente sigue pasando.

## Estructura de migraciones (una por historia, aditivas)

| Historia | Migración | Contenido | Reversión |
|---|---|---|---|
| F-TDA-16 | `20261202100000_tienda_contacto.sql` | `alter table dominio.empresas add column if not exists horarios text` (+ check ≤ 200) y `grant update (horarios)`; `dominio.tienda_envios` + RLS + índice + `unique (empresa_id, clave_envio)`; `private.visitante_hash`, `private.registrar_envio_tienda`, `private.entregar_a_bandeja`; `publico.contacto_por_dominio`, `publico.enviar_consulta_contacto` + grants | `drop function` de las cinco funciones; `drop table dominio.tienda_envios` y `alter table dominio.empresas drop column horarios` **en una migración posterior**, no en este PR (regla de aditividad) |
| F-TDA-14 | `20261202110000_tienda_whatsapp.sql` | `publico.registrar_consulta_whatsapp` + grants | `drop function publico.registrar_consulta_whatsapp(text, uuid, uuid)` |

Orden de despliegue: F-TDA-16 antes de F-TDA-14 (esta usa `registrar_envio_tienda`, `entregar_a_bandeja` y `contacto_por_dominio`). La función de F-TDA-14 se escribe en `plpgsql` (resolución en tiempo de ejecución), y el Plan de ejecución lo impone (F-TDA-14 depende de F-TDA-16). Cada migración es autosuficiente en su contenido propio; ninguna modifica los objetos de la otra.

## Contratos

Ver `contracts/tienda-contacto.md` (firmas de las funciones públicas e internas y del adaptador, y las rutas del front). Todo nuevo y aditivo; sin `BREAKING`. **Pendiente de confirmar**: la firma real de la interfaz F-CON-01 de MSF-122 (D4).

## Frontend

- **F-TDA-16**: `rutas/contacto.tsx` (migas, bloques de datos, formulario, 404 de subruta), `contacto/DatosContacto.tsx`, `contacto/FormularioContacto.tsx`, `contacto/validacion.ts`, `lib/tiendaContacto.ts` (cliente RPC + estados + `clave_envio` + `useContactoTienda`), enlaces en `layout/MenuCategorias.tsx` y `layout/PieCategorias.tsx`, y el campo «Horarios de atención» en `pages/empresas/edit.tsx`.
- **F-TDA-14**: `lib/whatsapp.ts` (normalizar número, armar mensaje, URL `wa.me`, `registrarConsultaWhatsapp` y la lectura del contacto de la tienda), `whatsapp/BotonWhatsApp.tsx`, `whatsapp/DialogoWhatsApp.tsx` (carga diferida) e integración en `rutas/producto.tsx` / `ficha/DatosProducto.tsx`. No edita `lib/tiendaContacto.ts` (es de F-TDA-16): reutiliza solo el cliente Supabase compartido y llama directamente a `publico.contacto_por_dominio`.
- Estados de carga/vacío/error/éxito del kit; teclado y lector de pantalla; 320/768/1440.

## Verificación

- **pgTAP**: `tienda_contacto.test.sql` (F-TDA-16) y `tienda_whatsapp.test.sql` (F-TDA-14) en `supabase/tests/database/`: aislamiento entre dos tiendas, `null` idéntico, lista blanca, límite y ventana, idempotencia, simultaneidad, reversión, RLS de `tienda_envios`.
- **Vitest + axe**: contacto, enlaces del menú/pie, campo de Empresas, botón, diálogo y utilidades de WhatsApp.
- **E2E** (`apps/web/e2e/tienda-contacto.e2e.ts`, `tienda-whatsapp.e2e.ts`): dos tiendas, de la ficha o el formulario a la bandeja, spam y límite.
- Gates: `pnpm lint`, `build`, `infra:config`, `test`, `prototipo:check`, `matriz:check`, `docs:check`.

## Riesgos

- **MSF-122 sin construir**: el E2E hasta la bandeja y el adaptador dependen de ella (bloqueo declarado). Mitigación: adaptador único y primera tarea de confirmación de la firma.
- **IP no disponible tras el proxy** (D6): falla cerrada; se prueba en el entorno.
- **Límite demasiado bajo o alto**: constante única, se ajusta con pruebas reales.
