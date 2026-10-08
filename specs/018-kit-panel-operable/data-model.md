# Modelo de datos y proyecciones del panel

## Principio

Esta funcionalidad no crea una entidad de negocio persistida. Agrega un
modelo de lectura mínimo para que el frontend no reconstruya autorización ni
identidades desde tablas protegidas. La migración es aditiva y conserva RLS
y los contratos existentes.

## ContextoPanel

| Campo | Tipo | Descripción |
|---|---|---|
| `es_superadmin` | boolean | Puede ver y operar destinos de audiencia `superadmin`. |
| `organizacion_id` | uuid nullable | Organización efectiva: membresía propia o activa de superadmin. No se muestra como texto. |
| `organizacion_nombre` | text nullable | Nombre de la organización efectiva, solo para orientación. |
| `rol_efectivo` | text nullable | Rol aplicable en la organización efectiva. |
| `puede_escribir` | boolean | Espejo de presentación de la regla del servidor; no autoriza operaciones por sí solo. |
| `puede_copiar_identificador_tecnico` | boolean | Verdadero solo para superadmin. |

**Fuente:** JWT actual y los helpers privados `private.is_superadmin()`,
`private.organizacion_id()`, `private.rol_id()`, `private.puede_escribir()`,
ya establecidos por specs anteriores del template.

**Acceso:** RPC pública `contexto_panel_actual()`, solo para `authenticated`,
sin parámetros. Devuelve valores nulos cuando no hay organización efectiva;
nunca una lista de organizaciones o usuarios ajenos.

## IdentidadPresentacion

| Campo | Tipo | Descripción |
|---|---|---|
| `nombre_visible` | text | Texto humano seguro para celda, tarjeta, encabezado o `aria-label`. |
| `estado_identidad` | enum textual | `resuelta`, `incompleta`, `eliminada`, `sistema` o `no_disponible`. |
| `tipo_origen` | enum textual | `persona`, `organizacion`, `reporte` o `sistema`, para diagnóstico de UI sin revelar ID. |

No contiene UUID como *fallback*. El identificador técnico se obtiene por una
acción separada, exclusivamente para superadmin.

### Orígenes que requieren proyección (ejemplos, no exhaustivo)

| Superficie | Origen típico | Proyección requerida |
|---|---|---|
| Listado de miembros | membresía y perfil | Nombre autorizado en el listado. |
| Actor de una automatización | un identificador de usuario en una tabla de auditoría | Nombre visible con *fallback* histórico — **fuera de esta spec**, depende del diseño final de la tabla de ejecuciones (ver nota de alcance en spec.md). |
| Elemento con ID técnico externo | UUID de un sistema externo o de plataforma | Nombre/título del elemento; el UUID queda oculto y copiable solo por superadmin. |

## DestinoNavegacion

| Campo | Descripción |
|---|---|
| `id` | Identificador interno del destino, único dentro del sider. |
| `etiqueta` e `icono` | Texto visible y semántica visual MUI. |
| `ruta` | URL del destino. |
| `audiencia` | `autenticada`, `organizacion`, `administrador` o `superadmin`. |
| `rutasAnteriores` | URLs opcionales que redirigen a la canónica con `replace`. |

El destino se filtra tanto en el sider como en la ruta real (`CanAccess`,
`RequiereOrganizacionActiva` o su equivalente, y RLS) — ocultar un ítem del
menú nunca sustituye la autorización del lado del servidor.

## Cambios de base

1. Una migración aditiva crea `public.contexto_panel_actual()`,
   `security definer`, `search_path` seguro, permisos explícitos y
   comentario de contrato.
2. No se elimina columna, tabla, policy ni función existente.
