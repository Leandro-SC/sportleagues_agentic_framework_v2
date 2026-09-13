import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export function hasSupabaseConfiguration(): boolean { return Boolean(url && anonKey) }

export function getSupabaseClient(): SupabaseClient {
  if (!url || !anonKey) throw new Error('Falta configurar VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.')
  return client ??= createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
  })
}

let client: SupabaseClient | undefined
