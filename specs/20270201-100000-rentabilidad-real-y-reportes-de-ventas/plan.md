# Implementation Plan: Inicio, rentabilidad y reportes · Rentabilidad real y reportes de ventas

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-192 · **Rama**: `epic/MSF-192-inicio-rentabilidad-y-reportes-rentabili`
**Alcance de entrega**: `refine` + `supabase` + `superset`. Sin `kestra` ni `workers`.

## Resumen

Dos líneas independientes. **Rentabilidad**: un catálogo de costos adicionales por empresa (F-REN-08) que la vista de margen de MSF-120 descuenta, y una captura de costo y cotización en cada línea de venta al confirmar (F-REN-09) que alimenta una vista de margen de lo efectivamente vendido y su tablero. **Reportes**: dos tableros de Superset en «Ventas · Reportes»: productos más consultados por WhatsApp (F-REP-04) y ventas por período y canal (F-REP-05). Todo se lee del esquema `analitica`; cada historia trae su propia migración aditiva.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/rentabilidad/` (sección «Costos adicionales» y pestaña `Ventas reales`) y `apps/web/src/pages/ventas-reportes/` (dos pestañas); se reutilizan `ReporteEmbebido`, `TableroReporte`, `FiltrosPeriodo`, `AccesoRestringido`, estados compartidos y `SelectorEmpresas`.
- **Base**: una tabla en `dominio` (`costos_adicionales_canal`), dos columnas nulables en `dominio.comprobantes_venta_lineas`, tres RPC de `public`, `confirmar_comprobante` con cuerpo ampliado (misma firma) y vistas/funciones en `analitica`. Aislamiento por `organizacion_id` + cláusula `rls` del guest token.
- **Superset**: YAML versionado; `rentabilidad/` suma «Ventas reales»; F-REP-04 y F-REP-05 crean un paquete cada uno (`consultas-reportes/`, `ventas-periodo-canal/`) para no compartir `reportes.json` y poder avanzar en paralelo. Registro idempotente con `importar-dashboards.mjs`.
- **Estado actual verificado** (repo): existen `analitica.margen_producto_canal`, `analitica.comprobante_cuenta_como_facturado`, `analitica.signo_comprobante`, `dominio.intereses_whatsapp`, `dominio.comprobantes_venta_lineas` (con `precio_unitario`, sin costo ni cotización), `private.a_pesos`, `public.confirmar_comprobante(uuid)`, paquetes `rentabilidad/` y `ventas-reportes/`. **No existen** los objetos nuevos de esta épica. Última migración del repo: `20270121110303`.
- **Migraciones** (sin depender entre historias): F-REN-08 `20270201100000`, `…100010`, `…100100`; F-REN-09 `20270201110000`, `…110100`, `…110200`; F-REP-04 `20270201120000`; F-REP-05 `20270201130000`.
- **Reversión** (todas aditivas): `drop view` / `drop function` de lo nuevo; la vista `margen_producto_canal` se restituye con su definición de `20261130100200`; las columnas nulables y la tabla nueva se eliminan en una migración posterior, nunca en el mismo PR que las crea; `confirmar_comprobante` se restituye con su definición de `20261204140000`.
- **Contratos**: `contracts/rentabilidad-real-y-reportes.md` (RPC nuevas, vistas, y `BREAKING` por la semántica de `margen`).

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | Tabla nueva con RLS; vistas con `organizacion_id` y token con `rls`; pgTAP con dos organizaciones (SC-002, SC-005, SC-008, SC-011). |
| II Spec primero | Esta spec; cada tarea cita FR/SC; los supuestos abiertos de la épica están declarados. |
| III Idempotencia/auditoría | Importación idempotente; `confirmar_comprobante` no reescribe costo ni cotización al repetirse. |
| IV Despliegues independientes | Superset conserva su Compose; sin variables nuevas. |
| V Simplicidad | Sin workers/Kestra; reutiliza embebido, rol y predicado únicos. |
| VI Panel operable | Pestañas y sección dentro de pantallas existentes (menú sin cambios); estados compartidos; teclado/lector; 320/768/1440 px; carga diferida ya resuelta en `ReporteEmbebido`. |
| VII Esquemas | `dominio.costos_adicionales_canal` y columnas de línea de venta → `dominio` (negocio); RPC en `public` (superficie); `analitica` solo vistas/funciones; reportes en `public`. Re-verificado en T001, T011 y T040. |
| VIII Empresa activa | Costos adicionales la respeta (SC-003); Ventas reales no aplica con motivo (SC-006); reportes de ventas siguen el patrón de MSF-338 (SC-009, SC-012). |
