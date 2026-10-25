/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_PREVIEW_DATA?: string
  readonly VITE_ENABLE_SUPERADMIN_UI?: string
  readonly VITE_APP_LINK_HOSTS?: string
  readonly VITE_LEGAL_CONTACT_EMAIL?: string
}
interface ImportMeta { readonly env: ImportMetaEnv }
