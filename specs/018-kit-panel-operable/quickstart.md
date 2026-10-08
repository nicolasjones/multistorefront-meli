# Quickstart: kit de panel operable

## Validar el mecanismo

1. `pnpm dev:supabase` (o `supabase start`).
2. `supabase db reset` — aplica `contexto_panel_actual()` desde cero contra
   el esquema completo del template.
3. `pnpm test:db` — confirma que la RPC nueva pasa pgTAP (permisos,
   `search_path`, ausencia de acceso para `anon`).
4. `pnpm --filter @platform/web test` — Vitest de `ContextoPanel`,
   `SiderPanel`, `MenuCuenta`, `EncabezadoPanel`, `IdentidadVisible`,
   `EstadosPagina`, `ContenidoAdaptable`, `ContenedorSeccion`,
   `ContextoOrganizacionActiva`.
5. `pnpm dev:refine` (o `pnpm dev:refine:host`) y recorrer manualmente:
   - Iniciar sesión como miembro sin rol de administrador → el sider muestra
     solo Inicio y Operación.
   - Iniciar sesión como administrador de una organización → aparece
     Configuración al abrir esa sección.
   - Iniciar sesión como superadmin sin organización activa → aparece
     Plataforma; no aparece ningún destino de audiencia `organizacion`.
   - Cambiar de organización de trabajo → el sider y el contenido se
     actualizan sin recarga completa del navegador.
   - Reducir el ancho de la ventana a menos de 600px en una pantalla con
     `ContenidoAdaptable` → la tabla se condensa en tarjetas sin perder
     acciones.

## Adoptar el kit en un producto derivado

1. Copiar `apps/web/src/context/ContextoPanel.tsx`,
   `apps/web/src/hooks/useContextoPanel.ts`, los componentes de
   `components/navegacion`, `components/estados`, `components/pagina` y
   `components/identidad/IdentidadVisible.tsx`, y la migración
   `contexto_panel_actual()` — vienen del `git merge upstream/main` del
   producto derivado, no hace falta copiarlos a mano.
2. Reemplazar `SECCIONES_PANEL` en `destinosPanel.ts` por los recursos
   propios del producto, agrupados por audiencia.
3. Envolver las rutas en `ContextoPanelProvider` y usar `SiderPanel`/
   `EncabezadoPanel` en el `ThemedLayout`, como ya hace `App.tsx` de este
   template tras esta spec.
4. Consumir `IdentidadVisible` donde el producto muestre una persona u
   organización, en vez de imprimir un UUID o un `user_id`.
