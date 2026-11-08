# Implementation Plan: Plataforma · Notificaciones, ayuda y exportación total (MSF-224)

**Spec**: [`spec.md`](./spec.md) · **Contratos**: [`contracts/notificaciones-ayuda-y-exportacion-total.md`](./contracts/notificaciones-ayuda-y-exportacion-total.md) · **Alcance de entrega**: `refine`, `supabase`, `kestra`, `workers`.

## Enfoque técnico

Tres historias casi independientes, que reutilizan lo ya entregado por MSF-189 y MSF-206.

- **F-NOT-02 (campanita)**: se agrega `leido_en` a `public.avisos_pendientes` y tres funciones `security definer` filtradas por `auth.uid()` (la tabla sigue sin políticas ni privilegios para `authenticated`). En el panel, un componente `CampanitaNotificaciones` entra en `EncabezadoPanel` entre `BusquedaGlobal` y `MenuCuenta`. Datos con TanStack Query (patrón del repo): conteo con `refetchInterval` de 60 s y `refetchIntervalInBackground: false`, más refetch al enfocar la pestaña; lista con `useInfiniteQuery` (cursor por `creado_en`) y `IntersectionObserver` + «Cargar más». El desplegable es un `Popover` MUI con los patrones compartidos de carga/vacío/error.
- **F-CFG-02 (ayuda)**: contenido estático en `apps/web/src/ayuda/` (un módulo por sección del menú, claves = `id` de destino de `SECCIONES_PANEL`), un resolver que reutiliza la lógica `coincide` de las migas de pan (se extrae a una función compartida en `destinosPanel.ts`, sin cambiar su comportamiento) y un `PanelAyuda` (`Drawer` MUI, foco devuelto al botón). Un test recorre `SECCIONES_PANEL` y falla si falta una entrada o sobra una. Sin tabla, sin red.
- **F-OPS-06 (exportación total)**: `public.solicitar_exportacion_total()` registra el proceso con `iniciar_proceso_masivo` sobre la conexión de exportación de la organización (la misma que usa la exportación diferida de comprobantes; si falta, `SIN_CONEXION_EXPORTACION`). Un iniciador privado análogo a `private.iniciar_exportacion_comprobantes` evita el requisito de administrador de `iniciar_ejecucion_worker` donde la función ya validó el permiso. El flow `infra/kestra/flows/exportar-organizacion.yml` (copia el patrón de `exportar-comprobantes.yml`) lanza el worker nuevo `workers/exportar-organizacion`, que lee por lotes con funciones `private` acotadas a la organización de la ejecución, escribe un CSV por conjunto en un ZIP (`fflate` 0.8.3, ya fijado en `workers/historial-importador`; sin dependencia nueva), lo sube al bucket privado y borra el anterior. La UI es un bloque en `/importaciones`.

## Esquemas y reversión (aditivo)

Verificado contra el repo (migraciones `20261210120000`–`20261210120600`, `20270211100001`–`100005`); ninguna tabla nueva.

| Migración (nombres tentativos) | Contenido | Esquema | Reversión (migración posterior) |
|---|---|---|---|
| `20270217300001_notificaciones_leido.sql` | `alter table public.avisos_pendientes add column leido_en` + índice | `public` | `drop index …; alter table … drop column leido_en` (en otro PR, no en el que la crea) |
| `20270217300002_notificaciones_funciones.sql` | `listar_notificaciones`, `contar_notificaciones_sin_leer`, `marcar_notificaciones_leidas` + grants | `public` | `drop function` de las tres |
| `20270217300003_exportacion_total_conjuntos.sql` | `private.conjuntos_exportacion_total`, `private.datos_exportacion_total`, `private.filas_exportacion_total` + grants al rol de worker | `private` | `drop function` de las tres |
| `20270217300004_exportacion_total_solicitud.sql` | `public.solicitar_exportacion_total`, iniciador privado, capacidad `exportar-organizacion-<org>`, bucket `exportaciones-organizacion` y política `select` | `public` / `private` / Storage | `drop function`, `drop policy … on storage.objects`, vaciar y borrar el bucket por la API de Storage |

Cada historia trae **su** migración con su propio timestamp; F-NOT-02 y F-OPS-06 no se encadenan. Re-verificar el esquema de cada objeto en tareas, implementación y PR (Principio VII).

## Lista de lo exportado (F-OPS-06, FR-031/FR-032)

- **Permitidas**: tablas con `organizacion_id` de `dominio` (catálogo, stock, ventas, clientes, proveedores, servicio, consultas, tiendas, etc.) y de `public` con datos de negocio de la organización (empresas, membresías con rol, listas configurables, comprobantes, etc.). La lista concreta se arma en T020 leyendo `information_schema` en el entorno de desarrollo y se congela en la función.
- **Excluidas (documentadas en la función y en `docs/exportacion-total.md`)**: `auth.*`, Vault/secretos, `conexiones` y credenciales, tokens OAuth, colas internas (`despachos_ejecucion`, `avisos_pendientes`), `ejecuciones_worker`, monitoreo (`eventos_monitoreo`, `alertas_monitoreo`) y los propios `procesos_masivos*`.
- La prueba de completitud (T022) recorre `public` + `dominio` y falla si una tabla con `organizacion_id` no está en ninguna de las dos listas.

## Decisiones técnicas

1. **Sin tabla de notificaciones**: se reutiliza `avisos_pendientes` (supuesto de la épica). Costo: la fila es también la cola de correo; por eso las funciones de la app son solo lectura/`leido_en` y nunca tocan `estado`.
2. **Funciones en vez de políticas RLS** para `authenticated`: se conserva «RLS sin políticas» de F-NOT-01 y la superficie queda en funciones con grants explícitos (CLAUDE.md: `anon` solo ejecuta las RPC de acceso).
3. **Ayuda estática**: sin tabla ni red; así no depende de la empresa activa y se versiona/revisa en el PR. Tope de longitud: 600 caracteres de texto + hasta 5 pasos de 140 caracteres (valor del plan; ajustable en el test).
4. **Descarga con URL firmada de Storage** (como comprobantes), sin RPC propio: la política restringe a administradores de la organización.
5. **Un solo archivo vigente** por organización: el worker borra el anterior al completar; evita tareas de limpieza y cabe en el patrón de tarea de cierre.
6. **Refresco de la campanita por sondeo** (60 s, pausado con la pestaña oculta) en lugar de Realtime: Realtime exigiría políticas `select` sobre `avisos_pendientes`, que F-NOT-01 evita deliberadamente.
7. **Doble verificación de acceso** del tipo (al emitir y al listar): si cambia el rol, los avisos de secciones perdidas dejan de verse.

## Riesgos

- **Completitud de la exportación**: una tabla olvidada deja datos fuera. Mitigación: prueba de completitud (FR-032) en CI.
- **Datos sensibles en el ZIP**: es la copia total de la organización. Mitigación: solo administradores, bucket privado, URL firmada corta, un solo archivo vigente, exclusiones de secretos y revisión con `crypto-secrets`/`authz-security` en el cierre.
- **Volumen**: lectura por lotes con `offset` estable y orden por clave primaria; ZIP en streaming hacia Storage.
- **Falta de pantallas dibujadas**: el desplegable, la ayuda y el bloque de exportación se construyen con el template; la diferencia con un eventual prototipo posterior se anota en el PR.
- **Conflicto de archivos** entre F-NOT-02 y F-CFG-02 (ambas editan `EncabezadoPanel.tsx`): por eso van en grupos distintos del plan de ejecución.

## Documentación

`docs/notificaciones-en-panel.md`, `docs/ayuda-en-panel.md`, `docs/exportacion-total.md`, sección en `workers/CONTRATO.md` y `workers/README.md`, variables en `infra/kestra/.env.example`, y la fila de la épica en `docs/roadmap-template.md` al cerrar (paso manual). Constitución v1.9.0: Principios VI (navegación/estados/a11y), VII (esquemas) y VIII (empresa activa) verificados en la matriz de la spec.
