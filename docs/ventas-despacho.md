# Ventas · Despacho: armado, control y entrega (F-VTA-15)

Historia F-VTA-15 de la épica MSF-135 (MSF-152, fase 1). Spec:
`specs/20261024-130000-ventas-despacho-y-faltantes/` (FR-001…FR-012, SC-001…SC-003). Prototipo:
`design/pantallas/VentasComprobante.dc.html` (tarjeta **Responsables** y chips del estado de despacho).

## Modelo

El despacho es un **campo propio de la factura**, separado del estado documental de MSF-159/MSF-177:

- **Esquema `dominio`** (Principio VII): `dominio.comprobantes_venta` (documento de venta) recibe, de forma
  aditiva, `estado_despacho`, `armo_id`, `controlo_id`, `entrego_id` (FK a `auth.users`, `on delete set null`) y
  `entregado_en`. Índice `(organizacion_id, empresa_id, estado_despacho)`.
- `estado_despacho` es nulable y solo puede existir en `tipo = 'factura'` (check). `estado` sigue siendo el estado
  documental (`borrador`, `confirmada`, `anulada`, …); los dos comparten los nombres `armando` e `incompleto` pero
  viven en columnas distintas y los mueven historias distintas.
- La RLS vigente de `dominio.comprobantes_venta` no cambia: se lee por organización y sección `ventas`. **No hay
  grants de escritura nuevos**: el estado y los responsables se escriben solo por RPC `security definer`. `anon` no
  tiene acceso.

## Estados y flujo (FR-001, FR-002, FR-003)

```
[*] --> sin_armar | armando | listo_para_despachar   (al confirmar, según la forma de envío)
sin_armar  --> armando               Empezar a armar
incompleto --> armando               Reanudar el armado (lo fija F-VTA-18)
armando    --> listo_para_despachar  Controlar
listo_para_despachar --> entregado   Entregar
entregado es terminal
```

- **Inicial (FR-002):** al pasar una factura a `confirmada`, el disparador
  `comprobantes_venta_estado_despacho_inicial` (`AFTER UPDATE OF estado`) fija el `estado_despacho_inicial` de su
  forma de envío (`envio_id`, misma organización y empresa) o `sin_armar` si no resuelve. Corre **una sola vez** (si
  ya hay estado no lo pisa), no toca `confirmar_comprobante` ni `updated_at`. Como corre después del `RETURNING`,
  la pantalla recarga el comprobante tras confirmar.
- **Transiciones (FR-003):** `cambiar_estado_despacho` solo acepta las del flujo. Un presupuesto, un borrador o una
  factura anulada se rechazan (`22023`/`55000`). Es **idempotente**: pedir el estado que ya tiene devuelve la fila
  sin tocar responsables ni stock. Usa **bloqueo optimista** por `p_actualizado_en` (`40001`) y toma la fila
  `for update`, así dos cambios simultáneos no se pisan.

## Responsables (FR-004, FR-005, FR-006)

| Paso | Quién puede | Regla |
|------|-------------|-------|
| Armó (`armando`) | Depósito o Administrador de la empresa | — |
| Controló (`listo_para_despachar`) | Depósito o Administrador de la empresa | Debe ser **distinto de quien armó**, salvo que sea Administrador |
| Entregó (`entregado`) | Rol con la acción `despachar` en Ventas | Fija `entregado_en` |

`listar_responsables_despacho(p_empresa_id, p_funcion)` devuelve los usuarios **activos** de la organización
elegibles para `armar`, `controlar` o `entregar` (nombre, rol y `user_id`); incluye a los Administradores de la
organización y a los miembros con rol en esa empresa. Exige ver Ventas en la tienda. Los selectores del comprobante
solo ofrecen esa lista; la autoridad final es la RPC.

## Acción `despachar` (FR-008)

Nueva acción `despachar` de la sección `ventas` en `public.permisos_rol_accion`:

- Amplía el check de acciones y la siembra inicial de `private.matriz_acciones_iniciales()`: **Administrador y
  Depósito en `true`**, el resto en `false`. Las organizaciones existentes reciben sus filas en la migración.
- `private.puede_accion` la exige **con Ventas al menos en `lectura`**: Depósito despacha aunque no tenga `edicion`.
  Es la respuesta a la decisión abierta 7 de la spec.
- Editar `despachar` desde la pantalla de Roles queda fuera de esta historia (mismo criterio que `editar_precio`).
  Si otro rol debe entregar, se le da la acción en la matriz: no hace falta migración.

## RPC (esquema `public`, `search_path = ''`, `revoke … from public, anon` + `grant execute … to authenticated`)

| Función | Qué hace |
|---------|----------|
| `obtener_despacho_comprobante(p_id)` | Estado de despacho, ids y nombres de Armó/Controló/Entregó, `entregado_en`, `updated_at` y `puede_despachar`. Exige ver Ventas en la tienda. Es la lectura de la tarjeta «Responsables». |
| `listar_responsables_despacho(p_empresa_id, p_funcion)` | Elegibles para un paso (`armar`/`controlar`/`entregar`) en una tienda. Exige ver Ventas. |
| `cambiar_estado_despacho(p_id, p_estado, p_responsable_id, p_actualizado_en)` | Avanza el despacho con las reglas de arriba y registra la actividad `despacho.estado_cambiado` («Despacho: *anterior* → *nuevo* en la factura *N* (*responsable*)»). |
| `private.descontar_reservas_entrega(p_comprobante_id)` | Al entregar, descuenta en la **misma transacción** las reservas activas de las líneas «A pedido» (referencia `comprobante:<id>:linea:<orden>`), con salida de stock y motivo «Entrega de producto a pedido». Todo o nada. Las líneas de stock normal no se tocan: ya se descontaron al confirmar. |
| `private.asignar_estado_despacho_inicial()` | Disparador del estado inicial al confirmar. Sin `grant` a `authenticated`. |
| `private.rol_usuario_en_empresa` / `private.responsable_despacho_habilitado` | Ayudas internas de elegibilidad. Sin `grant` a `authenticated`. |

Errores: `42501` sin sesión/organización, sin `despachar` o responsable no elegible · `22023` estado o dato inválido ·
`55000` transición no permitida o factura sin estado de despacho · `P0002` comprobante inexistente · `40001`
conflicto de edición. Los mensajes de la RPC llegan en castellano y la tarjeta los muestra tal cual (los técnicos se
traducen a un texto claro).

## Pantalla (FR-010, FR-012)

En `/ventas/comprobantes/:id`, **solo en una factura confirmada** (el despacho arranca al confirmar), aparece la
tarjeta **Responsables**:

- Chip del estado con su texto de ayuda, **Operador en solo lectura**, y **Armó / Controló / Entregó** con
  «Seleccionar». Solo es editable el campo del paso siguiente; los demás quedan en lectura con el responsable ya
  registrado.
- Acción de avance según el estado («Empezar a armar», «Reanudar el armado», «Controlar», «Entregar»), deshabilitada
  mientras no hay responsable o mientras la petición está en vuelo (el doble clic no manda dos veces).
- Carga, error con «Reintentar» y éxito con los componentes del kit.
- Sin la acción `despachar` se ve el estado y los responsables, pero no se puede avanzar (`puede_despachar`).
- **Empresa activa (Principio VIII):** al cambiar de tienda, la tarjeta suelta lo elegido, muestra el aviso y relee
  el despacho; la pantalla se cierra con aviso si la nueva tienda no es la del comprobante. Nunca se guarda un
  responsable bajo otra tienda. «Última petición gana»: una respuesta vieja de otra tienda no pisa la nueva.

Decisiones anotadas en el PR: el texto de «Entregado» se adapta a esta épica (el stock normal ya se descontó al
confirmar y al entregar solo se descuentan las reservas «A pedido»); la tarjeta no es un diálogo y se desmonta al
cerrar el comprobante.

## Pruebas

- pgTAP: `supabase/tests/despacho_estados.test.sql` (SC-001: estado inicial, transiciones, roles, Administrador,
  `40001`, `lectura` sin `despachar`, `anon`, otra organización) y `supabase/tests/despacho_entrega.test.sql`
  (SC-002: reservas «A pedido», todo o nada, reintento idempotente, stock normal intacto, presupuesto rechazado)
  (`pnpm test:db`).
- Vitest: `apps/web/src/components/ventas/ResponsablesDespacho.test.tsx` (SC-003: selectores, acciones por estado,
  errores del servidor, `lectura`, doble clic, cambio de empresa) y
  `apps/web/src/pages/ventas/comprobante.despacho.test.tsx` (integración en el comprobante y cierre con aviso)
  (`pnpm test:web`).

## Reversión

Migraciones **aditivas** (no se destruye nada que esta historia cree en el mismo PR). Para volver atrás, en una
migración posterior:

1. `drop trigger comprobantes_venta_estado_despacho_inicial` y `drop function private.asignar_estado_despacho_inicial()`.
2. `drop function public.cambiar_estado_despacho(uuid, text, uuid, timestamptz)`,
   `public.obtener_despacho_comprobante(uuid)`, `private.descontar_reservas_entrega(uuid)`,
   `private.etiqueta_estado_despacho(text)`, `public.listar_responsables_despacho(uuid, text)` y las ayudas
   `private.responsable_despacho_habilitado` y `private.rol_usuario_en_empresa`.
3. `delete from public.permisos_rol_accion where accion = 'despachar'`, restaurar el check de acciones y las
   definiciones previas de `private.matriz_acciones_iniciales()` y `private.puede_accion`.
4. `drop index comprobantes_venta_despacho_idx` y las columnas `estado_despacho`, `armo_id`, `controlo_id`,
   `entrego_id`, `entregado_en` (con sus checks).

Los despachos ya hechos **no se deshacen solos**: exportar los responsables antes de borrar las columnas y, si hubo
entregas, corregir el stock desde Stock (la entrega ya descontó las reservas «A pedido»).
