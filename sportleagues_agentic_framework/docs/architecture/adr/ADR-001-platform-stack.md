# ADR-001 — Stack de plataforma

- Estado: Accepted

## Decisión

Usar Vue 3 + Vite + Tailwind para la PWA, Supabase/PostgreSQL/RLS para backend y Capacitor como wrapper móvil.

## Razón

Comparte la mayor parte del código entre web y móvil y mantiene el toolchain liviano. Las reglas críticas no dependen del wrapper móvil.

## Consecuencia

La experiencia nativa avanzada deberá encapsularse detrás de adapters para no contaminar el dominio.
