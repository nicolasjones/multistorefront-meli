# Quickstart: validar la Fundación multi-tenant

## Prerrequisitos

- `pnpm dev:supabase` corriendo, migraciones aplicadas.
- Un superadmin en `superadmins` para probar los pasos 2 a 4. `supabase/seed.sql`
  ya da de alta uno de desarrollo (`superadmin@local.test` /
  `Superadmin-Local1!`) en cada `supabase db reset` — no hace falta el alta a
  mano salvo que quieras marcar a otro usuario. Sigue sin haber pantalla para
  esto a propósito (no es una acción que deba quedar expuesta en la UI).

## 1. Aislamiento real (US1, SC-001)

```powershell
pnpm test:db
```

**Resultado esperado**: el test pgTAP de aislamiento pasa — incluye casos
de lectura cruzada, escritura cruzada, y usuario sin membresía.

## 2. Crear una organización desde Refine (US2, SC-004)

1. Iniciar sesión como superadmin, ir a la pantalla "Organizaciones".
2. Click en "Crear organización", completar nombre + email del fundador.
3. Confirmar que la organización aparece en el listado.
4. Confirmar (bandeja de Mailpit local, `http://127.0.0.1:3103` — ver
   `docs/architecture.md`) que llegó el email de invitación.

**Resultado esperado**: menos de 2 minutos de punta a punta, sin ningún
paso manual en la base de datos.

## 3. Clientes: administrador vs. miembro (US3)

1. Aceptar la invitación del paso anterior, iniciar sesión como ese
   administrador.
2. Crear un cliente desde la pantalla "Clientes" — confirmar que aparece.
3. Agregar un segundo usuario a la misma organización con rol `miembro`
   (a mano, vía SQL, hasta que exista una pantalla de gestión de
   membresías — fuera de alcance de esta spec).
4. Iniciar sesión como ese miembro — confirmar que ve el cliente creado,
   pero no tiene ninguna acción de crear/editar disponible.

## 4. El superadmin entra a una organización (US4)

1. Como superadmin, volver al listado de organizaciones.
2. Click en "Ingresar" en la organización creada en el paso 2.
3. Confirmar que se puede crear/editar un cliente ahí, con los mismos
   permisos que el administrador.
4. Consultar `superadmin_entradas` — confirmar que quedó registrada la
   entrada (quién, cuándo, a qué organización).

## 5. Multi-tenant real (SC-001, con datos de dos organizaciones)

1. Repetir los pasos 2-3 para crear una segunda organización con su
   propio administrador.
2. Confirmar que ningún usuario de la organización 1 ve datos de la 2, y
   viceversa — ni como admin, ni como miembro.
