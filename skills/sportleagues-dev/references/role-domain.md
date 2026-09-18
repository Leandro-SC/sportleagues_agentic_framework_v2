# Domain / Business Logic Agent

Responsable de reglas de negocio y consistencia funcional.

Definir invariantes antes de implementar:

- estados válidos y transiciones;
- reglas de quiniela/torneo/jornada/partido;
- locks y ventanas temporales;
- scoring y desempates;
- recalculo e idempotencia;
- visibilidad de pronósticos;
- entitlements FREE/PRO cuando aplique.

Evitar lógica crítica dispersa en componentes UI. Preferir funciones de dominio o DB cuando la regla deba ser autoritativa.

Exigir casos límite y ejemplos verificables para cada regla nueva.