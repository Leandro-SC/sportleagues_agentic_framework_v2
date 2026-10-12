#!/usr/bin/env node
// Copia las banderas (4x3) de los países del catálogo desde el paquete MIT `flag-icons` (versión fija) a apps/platform/public/flags.
// Licencia MIT (https://github.com/lipis/flag-icons/blob/main/LICENSE): se incluye el aviso. Las banderas nacionales son símbolos oficiales de
// cada país; no hay escudos de clubes aquí (sin fuente libre autorizada).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const VERSION = '7.2.3'
const out = resolve(ROOT, 'apps/platform/public/flags')
const catalog = JSON.parse(readFileSync(resolve(ROOT, 'supabase/seed/catalog/catalog-wikidata.json'), 'utf8'))
mkdirSync(out, { recursive: true })

let total = 0
const missing = []
for (const { code } of catalog.countries) {
  const name = code.toLowerCase()
  const response = await fetch(`https://cdn.jsdelivr.net/npm/flag-icons@${VERSION}/flags/4x3/${name}.svg`)
  if (!response.ok) { missing.push(code); continue }
  const svg = await response.text()
  if (!svg.includes('<svg')) { missing.push(code); continue }
  writeFileSync(resolve(out, `${name}.svg`), svg, 'utf8')
  total += svg.length
}
const license = await (await fetch(`https://cdn.jsdelivr.net/npm/flag-icons@${VERSION}/LICENSE`)).text()
writeFileSync(resolve(out, 'LICENSE-flag-icons.txt'), `flag-icons v${VERSION} — https://github.com/lipis/flag-icons\n\n${license}`, 'utf8')
console.log(`Banderas copiadas: ${catalog.countries.length - missing.length}/${catalog.countries.length} (${(total / 1024).toFixed(0)} KB). Sin bandera: ${missing.join(', ') || 'ninguna'}`)
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify({ version: VERSION, codes: catalog.countries.map((c) => c.code).filter((c) => !missing.includes(c)).sort() }) + '\n', 'utf8')
