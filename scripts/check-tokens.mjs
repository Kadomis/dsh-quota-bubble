#!/usr/bin/env node
// Verifies the DTCG export (tokens.json) and the implementation (client.js) agree.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'))
const client = readFileSync(join(root, 'client.js'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const shipped = /const PLUGIN_VERSION = '([^']+)'/.exec(client)
if (shipped === null) {
  console.error('tokens check failed: PLUGIN_VERSION missing from client.js')
  process.exit(1)
}
if (shipped[1] !== pkg.version) {
  console.error(`tokens check failed: PLUGIN_VERSION ${shipped[1]} does not match package.json ${pkg.version}`)
  process.exit(1)
}
const normalized = client.replace(/\s+/g, ' ').toLowerCase()

const failures = []
let checked = 0

const walk = (node, path, visit) => {
  if (node === null || typeof node !== 'object') return
  if (typeof node.$value === 'string') {
    visit(node.$value, path)
    return
  }
  for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key, visit)
}

const hexOnly = /^#[0-9a-f]{6}$/i
walk(tokens.primitive.color, 'primitive.color', (value, path) => {
  checked += 1
  if (!normalized.includes(value.toLowerCase())) failures.push(`${path} ${value} is missing from client.js`)
})
for (const [theme, group] of Object.entries(tokens.semantic.color)) {
  for (const [key, token] of Object.entries(group)) {
    const value = token.$value
    checked += 1
    if (hexOnly.test(value)) {
      if (!normalized.includes(value.toLowerCase())) failures.push(`semantic.color.${theme}.${key} ${value} is missing from client.js`)
    } else if (token.$type === 'color') {
      failures.push(`semantic.color.${theme}.${key} must be a hex colour for the sync check`)
    }
  }
}

const resolve = (ref) => {
  const path = ref.replace(/^\{(.*)\}$/, '$1').split('.')
  let node = tokens
  for (const key of path) {
    if (node === null || typeof node !== 'object' || node[key] === undefined) return undefined
    node = node[key]
  }
  return node
}
walk(tokens.component, 'component', (value, path) => {
  checked += 1
  const match = /^\{(.+)\}$/.exec(value)
  if (match !== null && resolve(value) === undefined) failures.push(`${path} points at missing token ${value}`)
})

if (failures.length > 0) {
  console.error(`tokens check failed (${failures.length} of ${checked}):`)
  for (const failure of failures) console.error('  -', failure)
  process.exit(1)
}
console.log(`tokens check passed: ${checked} token values verified against client.js`)
