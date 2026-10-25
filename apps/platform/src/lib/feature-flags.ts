// Banderas de compilación de la app principal. Se leen de variables públicas de Vite
// (reemplazadas en build) y todas están APAGADAS por defecto.
//
// ADR-018: la UI de Superadmin (`/superadmin`, SuperadminView, SuperadminShell) no forma parte de
// la app pública. Solo se registra y se empaqueta si el build define VITE_ENABLE_SUPERADMIN_UI=true,
// algo que nunca debe hacerse en QA ni producción. Esto es únicamente superficie de UI: la
// autorización de plataforma (platform_admins, is_platform_admin(), RLS/RPC) vive en la base de
// datos y no depende de esta bandera.
type FlagEnv = { readonly VITE_ENABLE_SUPERADMIN_UI?: string }

export function isSuperadminUiEnabled(env: FlagEnv = import.meta.env): boolean {
  return env.VITE_ENABLE_SUPERADMIN_UI === 'true'
}
