# Investigación técnica: kit de panel operable

## 1. Navegación explícita y no derivada de recursos

**Decisión:** usar un esquema declarativo de destinos del panel y un sider
propio compuesto sobre MUI/Refine.

**Fundamento:** `SiderConSeccionesSuperadmin` divide recursos con `Set`
planos. Esa aproximación no representa anidación, no cubre el menú de cuenta
y mezcla etiquetas de producto con nombres internos de recursos. Un esquema
con sección, ruta, ícono, audiencia y permiso permite reagrupar sin cambiar
los recursos internos que Refine necesita para CRUD.

**Alternativas descartadas:**

- Conservar el sider automático y agregar más `Set`: aumenta la lógica
  implícita y no resuelve submenús ni jerarquía.
- Agregar una librería de navegación: MUI ya cubre `List`, `Collapse`, foco y
  responsive; sería una dependencia sin beneficio proporcional.

## 2. Un contexto efectivo compartido

**Decisión:** exponer una proyección de sesión de alcance mínimo y consumirla
desde un único proveedor/cache del panel.

**Fundamento:** resolver superadmin, organización efectiva, rol y permiso de
escritura con hooks independientes produce valores incompletos durante carga
y el sider puede cambiar de forma perceptible. Una proyección atómica
devuelve todo eso una sola vez; la UI solo la usa para presentación. RLS
sigue siendo la autorización real.

**Límites de seguridad:** la RPC no recibe `user_id`, toma `auth.uid()`, no
devuelve secretos ni membresías de terceros y falla cerrada sin sesión o sin
organización operable. Sus permisos se prueban con pgTAP.

**Alternativa descartada:** confiar en el rol de cliente — no sustituye RLS
ni permite una proyección coherente para superadmin con organización activa.

## 3. Identidades de presentación seguras

**Decisión:** resolver `nombre_visible` en proyecciones/RPCs autorizadas, con
*fallbacks* estables y sin leer perfiles ajenos desde el navegador.

**Fundamento:** un UUID pintado directo en una celda no ayuda a nadie a
tomar una decisión, y la tabla de perfiles está protegida por RLS, así que
un join genérico desde cliente no es válido.

**Reglas de texto:** nombre y apellido; nombre o apellido; `Perfil sin
completar`; `Usuario eliminado` cuando el actor histórico ya no exista; y
`Sistema` cuando el origen no tenga persona. Un UUID nunca es *fallback*
visible.

**Alternativa descartada:** solicitar perfiles individuales desde cada fila
— además de violar el límite de visibilidad, genera N+1 consultas.

## 4. Rutas diferidas para dependencias pesadas

**Decisión:** cargar páginas operativas mediante `React.lazy` y reservar
dependencias pesadas (por ejemplo, un SDK de embebido analítico) para su
propia ruta.

**Fundamento:** importar todas las páginas en el entrypoint hace crecer el
chunk inicial con dependencias que la mayoría de las sesiones no necesita de
entrada. El layout y la navegación se mantienen inmediatos; cada ruta
presenta *skeleton* mientras descarga su módulo.

**Alternativa descartada:** mostrar una pantalla vacía hasta que terminen las
consultas — no entrega *feedback* y dificulta distinguir carga, falta de
datos y error.

## 5. Estados y responsive como patrón, no como parches

**Decisión:** introducir encabezado, estado de carga, vacío, error y tabla
adaptable reutilizables en lugar de resolverlos por página.

**Fundamento:** componentes comunes dan consistencia, reducen el costo de
diseñar pantallas futuras y permiten pruebas de accesibilidad centralizadas.

**Criterio:** acciones de una fila siguen disponibles por teclado, los
estados usan texto y no solo color, y en móvil se conserva la información
crítica antes de convertir columnas secundarias en detalle.

## 6. Cambio de organización sin recarga del documento

**Decisión:** tras entrar o salir de una organización, invalidar contexto y
datos dependientes y navegar con el router de SPA.

**Fundamento:** una recarga completa (`window.location.assign`) empeora el
tiempo percibido y borra el estado de UI. Un evento de contexto puede
refrescar el proveedor, recursos Refine y controles de acceso sin perder el
*shell* de la aplicación.

**Alternativa descartada:** mantener `window.location.assign` — es confiable
pero es una recarga costosa y ya no es necesaria cuando el contexto tiene un
punto de invalidación explícito.
