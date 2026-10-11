// Falla si el dataset de vista previa viaja en el bundle de un build sin VITE_PREVIEW_DATA=true.
// Uso: npm run verify:bundle  (ejecuta el build y revisa apps/platform/dist/assets).
// Con VITE_PREVIEW_DATA=true el script espera lo contrario: el dataset debe estar en un chunk propio.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = fileURLToPath(new URL('../apps/platform/dist/assets/', import.meta.url))
// Marcadores propios del dataset de ejemplo (lib/sports-preview.ts); no existen en código real.
const markers = ['Sporting Cristal', 'Copa Universitaria', 'Fanático del Fútbol']
const previewBuild = process.env.VITE_PREVIEW_DATA === 'true'

const chunks = readdirSync(assets).filter((name) => name.endsWith('.js'))
const withPreview = chunks.filter((name) => {
  const source = readFileSync(join(assets, name), 'utf8')
  return markers.some((marker) => source.includes(marker))
})

if (previewBuild) {
  if (withPreview.length !== 1 || !withPreview[0].startsWith('sports-preview')) {
    console.error(`FAIL: con VITE_PREVIEW_DATA=true el dataset debe estar en un chunk "sports-preview-*" propio (encontrado: ${withPreview.join(', ') || 'ninguno'}).`)
    process.exit(1)
  }
  console.log(`OK (build de demo): dataset aislado en ${withPreview[0]}.`)
} else {
  if (withPreview.length) {
    console.error(`FAIL: el dataset de vista previa está en el bundle de producción: ${withPreview.join(', ')}.`)
    process.exit(1)
  }
  console.log(`OK: ${chunks.length} chunks JS revisados; el dataset de vista previa no está en el bundle.`)
}
