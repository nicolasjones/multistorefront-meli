---
owner: tecnico
sources:
  - specs
---

# Flujos

Los flujos importantes se documentan con **Mermaid** (inline) y, cuando aporta, con un **artefacto Archify** interactivo.

## Importación del historial (MSF-275)

- **[Dataflow interactivo](../diagrams/msf-275-dataflow.html)** — export del panel → Storage → worker → `historial_*` → consulta.
- **[Estados de la ejecución](../diagrams/msf-275-lifecycle.html)** — solicitada → en curso → exitosa/fallida, con la regla todo-o-nada.

```mermaid
flowchart LR
  A[Export CSV/Excel] --> B[Storage] --> C[Worker] --> D[historial_*] --> E[Pantalla /historial]
```

## Cambio de estado y entrega (MSF-303)

- **[Secuencia interactiva](../diagrams/msf-303-sequence.html)** — técnico → UI → RPC → `reparaciones` + `reparacion_historial` + evento.

- **Alta y edición (MSF-283)**: `crear_reparacion` valida tienda, cliente, modelo activo y técnico, asigna el próximo número de la empresa, el primer estado activo por `orden` y el ingreso de hoy (hora de Argentina), y escribe el evento `alta` y la actividad `reparacion.creada`. Edición con bloqueo optimista por `updated_at`.
- **Reglas**: cualquier estado activo se puede elegir desde otro (también hacia atrás); un estado que `cierra` solo con la entrega (diálogo de fecha y quién entregó); tras entregar o anular no hay más cambios.

## Consultas (MSF-122)

Alta pública → consulta `nueva` + aviso encolado → barrido de Kestra → correo → bandeja → atención manual.
Los tres estados son fijos y las transiciones son manuales; asignar o anotar no cambia el estado.

```mermaid
stateDiagram-v2
  [*] --> Nueva : crear_consulta_publica (formulario o WhatsApp)
  Nueva --> EnCurso : una persona la marca «En curso»
  EnCurso --> Resuelta : una persona la marca «Resuelta»
  Nueva --> Resuelta : una persona la marca «Resuelta»
  Resuelta --> Nueva : reabrir
  Resuelta --> EnCurso : reabrir
  EnCurso --> Nueva : volver a «Nueva»
```

```mermaid
flowchart LR
  T["Tienda (MSF-212)"] --> RPC["publico.crear_consulta_publica"]
  RPC --> C["dominio.consultas"]
  C --> A["dominio.consultas_avisos"]
  A --> K["Kestra avisos-consultas (cada minuto)"]
  K --> F["Edge Function enviar-aviso-consulta"]
  F --> M["SMTP / Mailpit"]
  C --> P["Bandeja /consultas"]
```

Detalle: [Consultas: modelo, RPC y aviso](consultas.md). Dueños: FR-002 (alta), FR-003 (edición y
actividad), FR-005…FR-008 (bandeja y empresa activa), FR-011…FR-013 (cola, envío y enlace).

## Ventas comprobantes (MSF-159)

La factura nace en `borrador`, se edita y al confirmar pasa a `confirmada` descontando stock por depósito.
El presupuesto nace `pendiente`, se puede aceptar o copiar y **nunca** mueve stock.

```mermaid
stateDiagram-v2
  [*] --> borrador : crear_comprobante(factura)
  borrador --> borrador : guardar_comprobante / guardar_lineas
  borrador --> confirmada : confirmar_comprobante (salida o reserva, todo o nada)
  confirmada --> [*]
```

```mermaid
sequenceDiagram
  actor Op as Operador
  participant UI as Comprobante (web)
  participant RPC as confirmar_comprobante
  participant ST as Stock por depósito (MSF-292)
  Op->>UI: Confirmar factura
  UI->>RPC: id del comprobante
  RPC->>RPC: valida factura, borrador y ≥ 1 línea
  loop cada línea
    alt línea de stock
      RPC->>ST: salida del depósito de la línea
    else línea «A pedido»
      RPC->>ST: reserva sin descontar
    end
  end
  alt falta stock
    RPC-->>UI: P0001 (producto y depósito), sin cambios parciales
  else todo disponible
    RPC->>RPC: estado confirmada + actividad
    RPC-->>UI: comprobante confirmado
  end
```

Detalle: [Ventas · comprobantes (técnico)](ventas-comprobantes.md#confirmacion-y-stock-f-vta-07).

## Catálogo (MSF-160)

- **[Arquitectura](../diagrams/msf-160-architecture.html)** y **[ERD](../diagrams/msf-160-erd.html)**.

## Acceso y sesión (MSF-119)

Ingreso → `bloqueo_acceso_hasta` → Auth (hook `verificar_intento_acceso` cuenta fallos) → consulta de `estado` (suspendido: rechazo y cierre) → sesión (`localStorage` con «Mantener», `sessionStorage` sin ella) → vence a 12 h de inactividad o por `timebox` de 30 días. Recuperación: aviso neutro → enlace de 1 h y un solo uso → definir contraseña. Dueño: spec `20261012-140000-acceso-y-organizacion`; tests: Vitest, pgTAP (`estado_usuario`, `bloqueo_servidor`, `rls_en_toda_tabla`, `aislamiento_organizaciones`) y `scripts/e2e-acceso.e2e.mjs`. Detalle: [Acceso](../acceso-ingreso.md).

## Convención

- **Mermaid** para lo que se lee en GitHub y en esta wiki.
- **Archify** para lo que se explora (zoom, foco, fuentes), validado con `finalize`.
- Todo flujo tiene un **dueño** (spec/FR) y un **test** (Vitest/pgTAP/e2e) que lo respalda.
