# Contrato: identidades de presentación

## Regla de representación

Las superficies de UI muestran `nombre_visible`; nunca muestran un UUID como
contenido principal, fallback ni `aria-label` de una persona u organización.

| Situación | `nombre_visible` |
|---|---|
| Nombre y apellido | `Nombre Apellido` |
| Un único dato de perfil | Dato disponible |
| Perfil sin datos | `Perfil sin completar` |
| Actor histórico eliminado | `Usuario eliminado` |
| Ejecución sin persona | `Sistema` |
| Organización no resoluble | `Organización no disponible` |

## Audiencias

| Acción/lectura | Miembro | Administrador | Superadmin |
|---|---:|---:|---:|
| Recibir nombres visibles autorizados | Sí, sólo su organización | Sí, sólo su organización | Sí, según contexto permitido |
| Leer perfiles de terceros directamente | No | No | No, salvo contrato específico existente |
| Recibir/copiar identificador técnico | No | No | Sí, acción secundaria explícita |

El botón “Copiar identificador técnico” no se renderiza ni se invoca para
quien no sea superadmin. La acción no convierte el identificador en texto
visible permanente y respeta la misma audiencia que su recurso.

## Compatibilidad

Los datos internos pueden mantener IDs para claves, rutas, mutaciones y joins.
Toda proyección que se use para una celda de actor, organización o reporte debe
tener su nombre visible en el mismo resultado autorizado, evitando solicitudes
por fila desde navegador.
