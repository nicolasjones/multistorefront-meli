# Plan de implementación: Kit de panel operable

**Rama técnica:** `018-kit-panel-operable`<br>
**Spec:** [spec.md](./spec.md)<br>
**Fecha:** 2026-09-22<br>
**Alcance de entrega:** `refine | supabase`

## Resumen

Portar el kit de navegación declarativa por audiencia, identidad de
presentación segura, estados de página consistentes, contenido adaptable y
contorno visual contenido — validado en un producto derivado en producción —
como capacidad reutilizable del template, reemplazando el filtrado plano
anterior (`SiderConSeccionesSuperadmin`) sin reorganizar las rutas ni los
recursos existentes del template.

## Contexto técnico

| Área | Decisión |
|---|---|
| Frontend | React 18, TypeScript, Refine 5, React Router y MUI ya presentes en `apps/web` |
| Datos y autorización | Supabase Postgres; una única RPC de lectura (`contexto_panel_actual`), `security definer`, sin parámetros |
| Navegación | Esquema declarativo propio para el sider (`destinosPanel.ts`), separado de los `resources` internos de Refine |
| Pruebas | Vitest para UI (contexto, sider, identidad, estados, contenido adaptable); pgTAP para la RPC nueva |
| Restricciones | Sin dependencias nuevas, sin reorganizar rutas del template, sin tocar workers/Kestra/Superset |

## Cumplimiento de la constitución

| Principio | Estado | Evidencia prevista |
|---|---|---|
| I. Aislamiento multi-tenant por diseño | Cumple | La RPC deriva todo del JWT actual, sin aceptar un `user_id` arbitrario |
| II. Especificar antes de implementar | Cumple | Esta spec documenta el patrón antes de portar el código real |
| IV. Un monorepo, despliegues independientes | Cumple | Solo Refine y una migración Supabase aditiva |
| V. Simplicidad operativa | Cumple | Reutiliza MUI/Refine existentes, no agrega dependencias |
| VI. Panel operable y extensible | Cumple | Esta spec es la implementación de referencia del Principio VI |

## Estructura

```text
apps/web/src/
├── context/ContextoPanel.tsx                 # contexto efectivo del panel e invalidación
├── hooks/useContextoPanel.ts                 # re-export del hook
├── components/
│   ├── navegacion/
│   │   ├── destinosPanel.ts                  # tipos + destinoVisible + destinos propios del template
│   │   ├── SiderPanel.tsx                    # sider declarativo por audiencia
│   │   ├── EncabezadoPanel.tsx               # header con MenuCuenta
│   │   └── MenuCuenta.tsx                    # menú compacto de cuenta
│   ├── estados/EstadosPagina.tsx             # carga, vacío, error, éxito
│   ├── pagina/
│   │   ├── EncabezadoPagina.tsx              # título + descripción + acción + contexto
│   │   ├── ContenidoAdaptable.tsx            # tabla ↔ tarjeta según ancho
│   │   ├── ContenedorSeccion.tsx             # contorno visual contenido
│   │   └── ContextoOrganizacionActiva.tsx    # texto de contexto de organización
│   └── identidad/IdentidadVisible.tsx        # nombre visible + copiar identificador técnico

supabase/
└── migrations/                               # RPC aditiva de contexto de panel
```

## Diseño y secuencia de implementación

1. Migración aditiva: `public.contexto_panel_actual()`, `security definer`,
   sin parámetros, deriva todo de `private.is_superadmin()`,
   `private.organizacion_id()`, `private.rol_id()`, `private.puede_escribir()`.
2. `ContextoPanelProvider`: cachea el contexto, invalida en un único punto
   (cambio de organización), sin recarga de documento.
3. `destinosPanel.ts`: tipos + `destinoVisible` como mecanismo portable;
   `SECCIONES_PANEL` con los destinos propios de cada producto (en este PR,
   los recursos ya existentes del template, agrupados por audiencia).
4. `SiderPanel`: renderiza `SECCIONES_PANEL` filtrado por `destinoVisible`,
   acordeón con una sección abierta por defecto.
5. `EncabezadoPanel` + `MenuCuenta`: header fijo con el menú de cuenta
   separado del menú de navegación principal.
6. `IdentidadVisible`: componente de presentación, sin acoplar a ninguna
   tabla de negocio — lo consume cada producto derivado donde lo necesite.
7. `EstadosPagina`, `EncabezadoPagina`, `ContenidoAdaptable`,
   `ContenedorSeccion`: primitivas de página reutilizables.
8. Reemplazar `SiderConSeccionesSuperadmin` por `SiderPanel`/`EncabezadoPanel`
   en `App.tsx`, envolviendo las rutas en `ContextoPanelProvider`. Las rutas
   existentes del template no cambian de URL.

## Quality gates

```powershell
pnpm lint
pnpm build
pnpm infra:config
pnpm test
```

## Complejidad y límites

No se justifica complejidad adicional. La migración es aditiva. Este PR no
incluye la resolución de actor de ejecución (ver nota de alcance en
spec.md) — depende de un diseño de `ejecuciones` todavía sin reconciliar
entre el template y un producto derivado.
