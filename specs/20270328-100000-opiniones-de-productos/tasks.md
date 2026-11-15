# Tasks: Opiniones de productos (MSF-467)

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md) · Formato: `- [ ] T001 [P] [USy] descripción — evidencia`.
Cada RF/SC tiene una tarea dueña. **Al cerrar cada fase ninguna tarea queda `[ ]`**: se hace con evidencia o se cierra con `Desvío: <motivo>` y un seguimiento trazado (regla de `CLAUDE.md`). En cada tarea que toca una tabla se **re-verifica el esquema** (Principio VII).

## Matriz de trazabilidad

| Historia | RF / CA / SC dueños | Tareas |
|---|---|---|
| Base | RF-OPI-1, 4, 5, 18, 19, SC-003 | T001–T006 |
| US1 Moderación | RF-OPI-13…15, CA-OPI-7, 8, 11 | T007–T012 |
| US2 Opinar | RF-OPI-2, 3, 6, 7, 8, 11, 17, CA-OPI-1…3, 5, 10 | T013–T020 |
| US3 Leer | RF-OPI-9, 10, 11, 12, CA-OPI-4, 6, 9, SC-001, 002, 004 | T021–T026 |
| Cierre | docs, E2E, encendido, guards | T027–T031 |

## Fase 1: Base de datos y bandera — sin efecto visible

- [x] T001 Migración `20270341000000_opiniones_producto.sql`: tabla `dominio.opiniones_producto`, checks, FK compuestas (cuenta, tienda, producto), índices, RLS sin políticas, sin privilegios, bandera `tienda_opiniones` apagada (RF-OPI-1, RF-OPI-4). Evidencia: pgTAP `opiniones_producto.test.sql`. Hecho (fase 1): `20270341000000_opiniones_producto.sql`; pgTAP `opiniones_producto.test.sql` 21/21 en dev.
- [x] T002 Migración `20270341000100_opiniones_validacion.sql`: `private.validar_texto_opinion` (largo, control, enlaces) y `private.nombre_publico_cliente` (RF-OPI-5, CA-OPI-6). Evidencia: pgTAP `opiniones_validacion.test.sql` (casos borde: 9/10/1.000/1.001, `http`, `www.`, dominio suelto, RTL, emoji). Hecho (fase 1): `20270341000100_opiniones_validacion.sql`; pgTAP `opiniones_validacion.test.sql` 33/33 en dev.
- [x] T003 [P] Aislamiento y seguridad: `rls_en_toda_tabla`, `privilegios_anon_endurecidos`, grants exactos, `search_path` (RF-OPI-16, SC-003). Evidencia: pgTAP `opiniones_privilegios.test.sql`. Hecho (fase 1 y 2): pgTAP `opiniones_privilegios.test.sql` 14/14; `rls_en_toda_tabla`, `privilegios_anon_endurecidos` y `service_role_privilegios` verdes en dev.
- [x] T004 Migración `20270341000500_exportacion_total_opiniones.sql`: la tabla entra a `conjuntos_exportacion_total` (RF-OPI-18, CA-OPI-12). Evidencia: pgTAP `exportacion_total.test.sql` extendido. Hecho (fase 1): `20270341000500_exportacion_total_opiniones.sql` sobre la última versión vigente (`20270334000002`); `exportacion_total.test.sql` 46/46 en dev.
- [x] T005 [P] Etiquetas `opinion.aceptada` / `opinion.rechazada` en Actividad (`pages/actividad`) y cobertura de ayuda. Evidencia: Vitest de Actividad y `ayuda-cobertura.test.ts`. Hecho (fase 2): etiquetas en `lib/actividad.ts`, ayuda en `ayuda/contenidos/canales.ts` y `manualPorDestino.ts`; Vitest de `ayuda` y `lib/actividad` verdes.
- [x] T006 Guards: `node scripts/verificar-migraciones.mjs --estricto`, `pnpm docs:check`, `pnpm matriz:check`, `pnpm der:check`, `tsc -b`, lint. Evidencia: salida de cada comando. Hecho (fase 1): `verificar-migraciones --estricto`, docs-check, `verificar-documentacion-cambios`, matriz, prototipo, ui-empresas y tsc verdes.

**Checkpoint Base**: la tabla existe, aislada y exportable; la bandera está apagada; nada cambia en la tienda ni en el panel.

## Fase 2: Moderación en el panel (US1)

- [x] T007 Migración `20270341000200_opiniones_moderacion_rpc.sql`: `public.listar_opiniones` y `public.moderar_opinion` (solo Administrador, contadores, cursor, bloqueo optimista, idempotencia, evento sin texto, apagada solo rechaza) (RF-OPI-13, RF-OPI-14). Evidencia: pgTAP `opiniones_moderacion.test.sql`. Hecho (fase 2): `20270341000200_opiniones_moderacion_rpc.sql`; pgTAP `opiniones_moderacion.test.sql` 46/46 en dev.
- [x] T008 Cliente de datos `lib/opiniones.ts` y hooks (listado por tandas con cursor, contadores, moderar con manejo de `conflicto`). Evidencia: Vitest de los hooks. Hecho (fase 2): `lib/opiniones.ts` + `hooks/useOpinionesPanel.ts`; Vitest `lib/opiniones.test.ts` y `pages/opiniones/list.test.tsx`.
- [x] T009 Pantalla `pages/opiniones/list.tsx` según el prototipo: aviso, `FiltroEmpresa`, contadores, filtros de estado, lista, Aceptar/Rechazar, diálogo de motivo (D5), carga infinita, estados compartidos, avisos de resultado (RF-OPI-15). Evidencia: Vitest `list.test.tsx` con axe a 320/768/1440 px. Hecho (fase 2): `pages/opiniones/list.tsx`; Vitest `list.test.tsx` con axe (el chequeo a 320/768/1440 px de jsdom no mide layout: se valida con la misma comprobación axe que el resto de pantallas del panel).
- [x] T010 Entrada de menú «Opiniones» (solo administrador), ruta `/opiniones` lazy, ícono del prototipo, aviso con la bandera apagada. Evidencia: Vitest de navegación y de audiencia (CA-OPI-8). Hecho (fase 2): destino «Opiniones» (Canales, administrador), ruta `/opiniones` lazy, aviso con la bandera apagada; Vitest de destino y de `manual`/`ayuda-cobertura`.
- [x] T011 [P] Fila «Empresa activa»: test que cambia la empresa con la pantalla y el diálogo abiertos y verifica recarga de lista y contadores, tanda reiniciada, selección descartada y diálogo cerrado con aviso (CA-OPI-11). Evidencia: `list.test.tsx`. Hecho (fase 2): caso «cambiar la empresa activa con el diálogo abierto» en `list.test.tsx`.
- [x] T012 Guards de la fase (los de T006) y `pnpm ui:empresas:check`. Evidencia: salida de cada comando. Hecho (fase 2): guards de T006 y `ui:empresas:check` verdes.

**Checkpoint Moderación**: con opiniones sembradas por SQL en dev, un administrador las acepta y rechaza; la tienda aún no muestra nada.

## Fase 3: Opinar desde la tienda (US2)

- [ ] T013 Migración `20270341000300_opiniones_cliente_rpc.sql`: `publico.guardar_opinion_por_dominio`, `borrar_opinion_por_dominio`, `mis_opiniones_por_dominio` (identidad solo de `cuenta_de_tienda`, upsert, vuelve a `pendiente`, topes, producto visible, límite por visitante) (RF-OPI-2…8, RF-OPI-17). Evidencia: pgTAP `opiniones_cliente.test.sql` y `opiniones_limites.test.sql`.
- [ ] T014 [P] pgTAP de aislamiento: cuenta de la tienda A vs. B y otra organización, `sin_acceso` idéntico en todos los casos (CA-OPI-5). Evidencia: `opiniones_cliente.test.sql`.
- [ ] T015 [P] pgTAP de bandera apagada: `sin_acceso` y tabla sin cambios (CA-OPI-9, SC-004). Evidencia: `opiniones_bandera.test.sql`.
- [ ] T016 Cliente de datos `lib/tiendaOpiniones.ts`, hooks y `validacion.ts` espejo del servidor. Evidencia: Vitest `validacion.test.ts` (mismos casos que T002).
- [ ] T017 Componentes `EstrellasPuntuacion` (teclado y lector), `FormularioOpinion` (contador, errores por campo, mensaje «se publicará cuando la revisemos», invitación a ingresar sin sesión) y «Mis opiniones» en la cuenta (editar, borrar con confirmación, estado y motivo). Evidencia: Vitest con axe.
- [ ] T018 Fusión de clientes: la unicidad `(cuenta, producto)` no rompe la fusión; se conserva la opinión más reciente y se avisa en la vista previa (caso borde). Evidencia: pgTAP de `fusion_clientes` extendido. Si la fusión no mueve cuentas web hoy, cerrar con `Desvío` y la prueba que lo demuestra.
- [ ] T019 [P] Cuenta suspendida o baja de «Habilitado en»: no escribe, y lo aceptado sigue visible (caso borde). Evidencia: pgTAP `opiniones_cliente.test.sql`.
- [ ] T020 Verificar `private.registrar_pedido_publico` con claves nuevas y tope 10/30 por minuto; extender sin romper llamadas existentes si hiciera falta. Evidencia: pgTAP `opiniones_limites.test.sql` y los pgTAP de búsqueda y pedidos siguen verdes.

**Checkpoint Opinar**: con la bandera encendida en dev, un cliente opina, edita y borra; su opinión queda pendiente y no se ve en la ficha.

## Fase 4: Leer en la ficha (US3)

- [ ] T021 Migración `20270341000400_opiniones_lectura_publica.sql`: `publico.opiniones_producto_por_dominio` (lista blanca, promedio, cantidad, cursor, producto visible, `es_mia`) y `publico.capacidades_opiniones_por_dominio` (RF-OPI-9, RF-OPI-10). Evidencia: pgTAP `opiniones_lectura.test.sql`.
- [ ] T022 [P] pgTAP de barrido por rol: `anon`, otra tienda y la propia cuenta no ven pendientes ni rechazadas por ninguna RPC (SC-001), y promedio/cantidad exactos con muestra mixta (SC-002). Evidencia: `opiniones_lectura.test.sql`.
- [ ] T023 Bloque `OpinionesProducto` en la ficha (promedio, cantidad, lista por tandas, «Cargar más», estado vacío) montado solo con la capacidad activa. Evidencia: Vitest con axe a 320/768/1440 px.
- [ ] T024 [P] Paridad con la bandera apagada: la ficha y «Mi cuenta» son idénticas a las de `dokploy` (RF-OPI-12). Evidencia: Vitest de paridad.
- [ ] T025 [P] Texto literal: un comentario con `<script>` se muestra como texto (CA-OPI-3). Evidencia: Vitest.
- [ ] T026 Guards de la fase (los de T006). Evidencia: salida de cada comando.

**Checkpoint Leer**: con la bandera encendida en dev, la ficha muestra promedio, cantidad y las opiniones aceptadas de su tienda.

## Fase 5: Cierre

- [ ] T027 E2E `apps/web/e2e/tienda-opiniones.e2e.ts`: opinar → no visible → aceptar → visible con promedio → editar → oculta → borrar. Evidencia: `pnpm --filter @platform/web test:e2e tienda-opiniones`.
- [ ] T028 Documentación: `docs/tienda-opiniones.md` (guía y reversión), enlace en `docs/tiendas-online.md`, `mkdocs.yml` y `docs/roadmap-template.md` (fila de MSF-467). Evidencia: `pnpm docs:check`.
- [ ] T029 Revisión de seguridad de la épica (autorización/RLS, texto no confiable, límites) con hallazgos menores arreglados. Evidencia: informe en la nota del PR.
- [ ] T030 Encendido de `tienda_opiniones` **solo en dev**, con SQL del equipo técnico y verificación del bundle de dev; staging y producción quedan apagados (D11). Evidencia: nota con el comando y la comprobación.
- [ ] T031 Guards finales: `pnpm lint`, `pnpm build`, `pnpm infra:config`, `pnpm test:db`, `pnpm matriz:check`, `pnpm der:check`, `node scripts/verificar-migraciones.mjs --estricto`. Evidencia: salida de cada comando.

**Checkpoint final**: Nicolás revisa las decisiones delegadas D1–D16; con la bandera apagada, todo es idéntico a hoy.
