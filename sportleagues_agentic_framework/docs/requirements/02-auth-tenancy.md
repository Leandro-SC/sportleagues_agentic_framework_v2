# Requisitos — Auth y tenancy

- Auth con Google y/o magic link según capacidades configuradas de Supabase.
- Un usuario puede pertenecer a varios tenants.
- Roles mínimos: owner/admin/member; separar rol de tenant de estado de participante.
- Join de torneo mediante código opaco de 6 caracteres o token de invitación.
- El código permite descubrir/unirse según reglas, no concede permisos administrativos.
- Todas las políticas RLS deben tener casos allow/deny documentados.
