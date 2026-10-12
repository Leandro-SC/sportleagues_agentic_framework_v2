import type { AdminFinanceClient, FinanceQuery, FinanceResult } from '../composables/useAdminFinance'

// Doble de pruebas del cliente de Supabase para «Mis finanzas». Aplica los filtros eq/in/range
// sobre filas en memoria (como lo haría PostgREST) y registra cada consulta para poder afirmar
// QUÉ se consultó. Solo lo importan archivos .test.ts.
type Table = 'tenant_memberships' | 'tenants' | 'pools' | 'participants'
type Row = Record<string, unknown>
export type RecordedQuery = { table: Table; columns: string; eq: Record<string, unknown>; inFilter: Record<string, string[]>; range: [number, number] | null }

export function createFakeFinanceClient(tables: Partial<Record<Table, Row[]>>, options: { failTables?: Table[]; throwTables?: Table[] } = {}) {
  const queries: RecordedQuery[] = []
  const client: AdminFinanceClient = {
    from(table) {
      return {
        select(columns: string): FinanceQuery {
          const query: RecordedQuery = { table, columns, eq: {}, inFilter: {}, range: null }
          queries.push(query)
          const builder: FinanceQuery = {
            eq(column, value) { query.eq[column] = value; return builder },
            in(column, values) { query.inFilter[column] = values; return builder },
            order() { return builder },
            range(from, to) { query.range = [from, to]; return builder },
            then(onfulfilled, onrejected) {
              const run = (): FinanceResult => {
                if (options.throwTables?.includes(table)) throw new TypeError('Failed to fetch')
                if (options.failTables?.includes(table)) return { data: null, error: { message: 'boom' } }
                let rows = (tables[table] ?? []).filter((row) => Object.entries(query.eq).every(([key, value]) => row[key] === value))
                for (const [key, values] of Object.entries(query.inFilter)) rows = rows.filter((row) => values.includes(row[key] as string))
                if (query.range) rows = rows.slice(query.range[0], query.range[1] + 1)
                return { data: rows, error: null }
              }
              return Promise.resolve().then(run).then(onfulfilled, onrejected)
            },
          }
          return builder
        },
      }
    },
  }
  return { client, queries }
}
