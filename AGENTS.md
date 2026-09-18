# AGENTS.md — Contrato permanente para agentes IA

## 1. Rol colectivo

Los agentes trabajan como un equipo de ingeniería senior para una plataforma SaaS multi-tenant móvil-first. Cada agente conserva su especialidad, pero todos obedecen este archivo y los ADRs aceptados.

## 2. Fuente de verdad

Orden de precedencia:

1. `AGENTS.md`
2. ADRs aceptados en `docs/architecture/adr/`
3. `PROJECT_CONFIG.md`
4. `docs/product/PRD-MVP.md`
5. requisitos específicos en `docs/requirements/`
6. prompt de la fase actual
7. reportes de fases anteriores

Si existe contradicción material, no inventar una solución: registrar un bloqueo/ADR.

## 3. Alcance del MVP

Implementar únicamente:

- multi-tenancy;
- autenticación y onboarding;
- gestión de quinielas, torneos y partidos;
- reglas de puntuación configurables;
- pronósticos y bloqueo temporal server-side;
- estado manual de pago/participación;
- leaderboard general/por jornada/rachas;
- Elo + Poisson y auto-fill estadístico;
- branding freemium/PRO;
- flyers HD y compartir;
- PWA + wrapper Capacitor;
- observabilidad, testing, seguridad y release.

No implementar como MVP: escrow, wallet, cobro automático, sportsbook, odds monetizadas, iGaming, chat masivo, DaaS enterprise.

## 4. Arquitectura base no negociable salvo ADR

- Vue 3 Composition API + Vite.
- Tailwind CSS + Lucide Icons.
- Supabase: PostgreSQL, Auth y RLS.
- SQL/Stored Procedures para Elo, Poisson, scoring y operaciones transaccionales críticas.
- Capacitor para empaquetado móvil.
- HTML5 Canvas/html2canvas para flyers.

Cambiar una de estas decisiones requiere ADR explícito.

## 5. Seguridad multi-tenant

Toda tabla tenant-owned debe tener `tenant_id` o una relación inequívoca hacia el tenant y RLS activa.

Reglas obligatorias:

- nunca confiar en `tenant_id` recibido del cliente para autorizar;
- derivar permisos del usuario autenticado y membresías;
- bloquear acceso cruzado entre tenants con políticas RLS y tests negativos;
- operaciones críticas deben validarse server-side/DB, no solo en UI;
- no usar service-role key en frontend;
- secretos solo en entorno seguro;
- minimizar PII y logs;
- auditar cambios administrativos relevantes.

## 6. Integridad de pronósticos

- La hora de cierre se evalúa en servidor/DB usando tiempo confiable.
- No permitir crear/editar pronósticos después del lock.
- Los pronósticos de otros jugadores permanecen ocultos hasta el inicio/bloqueo definido.
- El scoring debe ser determinístico, idempotente y testeable.
- Un cambio de resultado oficial debe producir recálculo consistente sin duplicar puntos.

## 7. Regla del motor estadístico

El auto-fill del MVP usa Elo + Poisson. No presentarlo como certeza ni como recomendación de apuesta. Guardar, si se necesita, versión de modelo y timestamp del cálculo para trazabilidad.

## 8. Disciplina de agentes

Cada agente debe:

- inspeccionar antes de editar;
- declarar archivos que modificará;
- hacer cambios mínimos y cohesionados;
- no editar zonas de otro agente en paralelo salvo handoff explícito;
- no reescribir archivos no relacionados;
- no añadir dependencias sin justificar y registrar;
- no dejar pseudocódigo o `TODO` como solución final de una tarea cerrada;
- actualizar reporte de fase y `PROJECT_STATE.md`.

## 9. Zonas de responsabilidad

- Architect: `docs/architecture/**`, contratos y ADRs.
- Data/RLS: `supabase/**` y modelos de dominio relacionados.
- Frontend: `apps/platform/src/**`, `packages/ui/**`.
- Domain/Scoring: `packages/domain/**`, funciones SQL de scoring.
- Mobile: `mobile/**` y configuración Capacitor/PWA.
- QA: tests; puede proponer fixes, pero no debe hacer refactors amplios.
- Security: políticas, hardening, revisión de secretos/permisos; fixes focalizados.
- Release: CI/CD, build, versionado, checklist de publicación.

## 10. Contrato de handoff

Todo handoff debe registrar:

- fase/tarea;
- objetivo;
- archivos cambiados;
- decisiones tomadas;
- tests ejecutados y resultado;
- riesgos/limitaciones;
- próximos pasos permitidos;
- bloqueos.

Usar `docs/agents/HANDOFF-TEMPLATE.md`.

## 11. Gates obligatorios

Una fase no termina sin:

- aceptación funcional del alcance;
- tests relevantes;
- revisión de RLS/autorización si toca datos;
- revisión de errores y estados vacíos;
- documentación actualizada;
- evidencia de comandos ejecutados;
- `git diff --check` cuando exista repositorio Git.

## 12. Condiciones de pausa/ADR

Crear ADR o bloquear cuando una decisión:

- cambia esquema central o relaciones multi-tenant;
- cambia auth/autorización;
- modifica reglas de scoring/desempate;
- añade un proveedor externo o SDK;
- introduce procesamiento de dinero real;
- cambia datos personales almacenados;
- cambia API pública;
- cambia stack base;
- afecta compatibilidad de builds móviles.
