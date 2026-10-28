# Plan de implementación: Clientes y proveedores · Correo masivo a clientes

**Spec**: `spec.md` · **Contratos**: `contracts/correo-masivo.md` · **Alcance de entrega**: `refine`, `supabase`, `kestra`

## Contexto técnico

- Frontend en `apps/web` (Refine + MUI, componentes compartidos `FiltroEmpresa`, patrones de carga/vacío/error). Reutiliza `useFiltroPorEmpresaActiva` de `pages/clientes/list.tsx` y la selección por casillas ya presente en el listado.
- Datos en Supabase self-hosted. Esquemas (Principio VII): columna `acepta_correo_masivo` en `public.clientes` (preexistente en `public`); `dominio.campanas_correo` y `dominio.campana_correo_destinatarios` en `dominio`. RLS por organización y sección `clientes`; escritura solo por RPC.
- Envío: nuevo flow `infra/kestra/flows/correo-masivo.yml` (modelo `comprobantes-correo.yml` y `enviar-avisos.yml`): corre cada minuto, reclama un lote con `private.reclamar_lote_correo_masivo`, envía por el SMTP de Kestra (`KESTRA_SMTP_*`) y cierra cada destinatario. El tamaño de lote y el límite diario vienen de variables de Kestra (`CORREO_MASIVO_LOTE`, `CORREO_MASIVO_LIMITE_DIARIO`; se documentan en `infra/kestra/.env.example`, valores propuestos 50 y 500).
- Baja: Edge Function `supabase/functions/baja-correo-masivo` (patrón `recuperar-clave-cliente`, service-role solo allí) y ruta pública `/baja-correo/:token` en el frontend. El token es aleatorio (≥ 128 bits), se guarda solo su hash SHA-256 y el enlace se arma al enviar.
- Límites de redacción: Asunto ≤ 200 caracteres, Mensaje ≤ 10 000; el mensaje se escapa y se arma como texto con saltos de línea (sin HTML libre).

## Migraciones (aditivas, con reversión en el encabezado)

| Historia | Migración (timestamp propuesto) | Contenido |
|---|---|---|
| F-CLI-11 | `20270114100000_clientes_acepta_correo_masivo.sql` | Columna + `listar_` y `resumen_destinatarios_correo_masivo` |
| F-CLI-12 | `20270114110000_campanas_correo.sql` | Tablas `dominio.campanas_correo` y `campana_correo_destinatarios`, RLS, índices |
| F-CLI-12 | `20270114110100_campanas_correo_crear.sql` | `crear_campana_correo`, `solicitar_prueba_correo_masivo`, actividad |
| F-CLI-12 | `20270114110200_campanas_correo_lote.sql` | `reclamar_lote_correo_masivo`, `cerrar_envio_correo_masivo`, `dar_de_baja_correo_masivo`, permisos del rol de Kestra |
| F-CLI-13 | `20270114120000_campanas_correo_historial.sql` | `listar_campanas_correo`, `detalle_campana_correo` (solo lectura sobre las tablas de F-CLI-12) |

Reversión (migraciones posteriores, nunca en el mismo PR): `drop function …`, `drop table dominio.campana_correo_destinatarios`, `drop table dominio.campanas_correo`, `alter table public.clientes drop column acepta_correo_masivo`.

## Frontend

- `apps/web/src/pages/clientes/correo-masivo/` — `nueva.tsx` (filtros + destinatarios + redacción + vista previa + prueba), `historial.tsx`, `detalle.tsx`; `components/clientes/DialogoCorreoSeleccionados.tsx` (diálogo del prototipo); interruptor en `FormularioCliente` y en el bloque «Comunicaciones» de `show.tsx`; página pública `pages/baja-correo.tsx`.
- Menú Clientes con la entrada «Correo masivo» (ícono de sobre) y pestañas «Nueva campaña» / «Historial».
- Textos del prototipo literales; lo no dibujado (pantalla, vista previa, prueba, baja, historial) usa componentes del sistema de diseño y se anota en el PR.

## Seguridad

- `anon` no ejecuta RPC nuevas; la baja pasa por Edge Function con token de alto entropía y respuesta uniforme.
- El hash del token no se expone por PostgREST (sin `grant select` sobre la columna).
- Errores de envío sanitizados (sin hosts ni credenciales); actividad sin cuerpo ni correos.
- Sin service-role en el navegador.

## Documentación

`docs/correo-masivo.md` (nuevo, lo crea F-CLI-11 y lo amplían F-CLI-12 y F-CLI-13), enlace desde `docs/clientes.md`, variables nuevas en `infra/kestra/.env.example`, y la fila de la épica en `docs/roadmap-template.md` al cerrar.

## Verificación de la constitución

| Principio | Cumplimiento |
|---|---|
| I, VII | RLS en las dos tablas nuevas; esquemas declarados; pgTAP recorre `public` + `dominio` |
| III | Outbox idempotente, reclamo con vencimiento, estado/error/timestamps por destinatario |
| IV | Flow de Kestra y Edge Function con despliegue propio; sin Compose raíz |
| VI | Ubicación en menú, rutas, patrones compartidos, accesibilidad y anchos declarados |
| VIII | Empresa activa en pantalla, diálogo e historial (FR-007, FR-036) con test de cambio de empresa |
