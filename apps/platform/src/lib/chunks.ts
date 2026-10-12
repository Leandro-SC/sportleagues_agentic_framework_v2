// Trocea listas largas para filtros `.in()` de PostgREST (FE-11): cada id va en la URL (un UUID ocupa ~37 caracteres con la coma),
// así que una parrilla de cientos de partidos puede superar el límite de URL del proxy. 100 ids ≈ 3.7 KB por petición.
export const IN_FILTER_CHUNK_SIZE = 100

export function chunk<T>(list: readonly T[], size: number = IN_FILTER_CHUNK_SIZE): T[][] {
  const length = Math.max(1, Math.floor(size))
  const parts: T[][] = []
  for (let index = 0; index < list.length; index += length) parts.push(list.slice(index, index + length))
  return parts
}

/** Ejecuta `read` por lotes de ids (en paralelo) y concatena los resultados en el orden de los lotes. Lista vacía => sin peticiones. */
export async function readInChunks<T>(ids: readonly string[], read: (batch: string[]) => Promise<T[]>, size: number = IN_FILTER_CHUNK_SIZE): Promise<T[]> {
  const batches = await Promise.all(chunk(ids, size).map((batch) => read(batch)))
  return batches.flat()
}
