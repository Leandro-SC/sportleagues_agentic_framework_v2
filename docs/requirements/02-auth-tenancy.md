# Requisitos — Auth y tenancy

- Auth con correo y contraseña (registro con nombre completo, confirmación de correo, recuperación de contraseña) y Google OAuth, ambos vía Supabase Auth. Magic Link no se ofrece al usuario (ADR-013).
- Un usuario puede pertenecer a varios tenants.
- Roles mínimos: owner/admin/member; separar rol de tenant de estado de participante.
- Join de torneo mediante código opaco de 6 caracteres o token de invitación.
- El código permite descubrir/unirse según reglas, no concede permisos administrativos.
- Todas las políticas RLS deben tener casos allow/deny documentados.
- Incompatibilidad administrador/participante por quiniela, incluida la histórica tras la apertura: se impone en DB/RPC, no solo en UI (ADR-015). El rol `member` no es capacidad administrativa; otras quinielas no se ven afectadas.
