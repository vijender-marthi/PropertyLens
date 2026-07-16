import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const requiredFiles = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/standards/ARCHITECTURE_CONSTITUTION.md',
  'docs/standards/UI_DESIGN_STANDARDS.md',
  'docs/standards/DOMAIN_RULES.md',
  'docs/standards/AI_CODING_INSTRUCTIONS.md',
  'docs/standards/CHANGE_CONTROL.md',
  'docs/standards/PR_CHECKLIST.md',
  'docs/standards/CURRENT_VIOLATIONS.md',
  'frontend/src/utils/formatters.js',
  'frontend/src/utils/formatters.test.js',
  'frontend/src/components/PageContainer.jsx',
]

const allowedFormatterFiles = new Set([
  path.join(root, 'frontend/src/utils/formatters.js'),
  path.join(root, 'frontend/src/utils/formatters.test.js'),
])

const hardFailPatterns = [
  {
    name: 'Direct Intl.NumberFormat in UI',
    regex: /Intl\.NumberFormat/g,
    allowed: allowedFormatterFiles,
  },
  {
    name: 'Direct toLocaleString in UI',
    regex: /\.toLocaleString\s*\(/g,
    allowed: allowedFormatterFiles,
  },
  {
    name: 'Direct toFixed display formatting in UI',
    regex: /\.toFixed\s*\(/g,
    allowed: allowedFormatterFiles,
  },
  {
    name: 'Manual compact currency suffix in UI',
    regex: /\$\{[^}\n]+\}\s*[KMB]\b|\$[0-9][0-9.,]*[KMB]\b/g,
    allowed: new Set([
      ...allowedFormatterFiles,
      path.join(root, 'frontend/src/pages/LandingPage.jsx'),
    ]),
  },
  {
    name: 'Frontend importing backend modules',
    regex: /from\s+['"][^'"]*backend\/|import\s*\([^)]*backend\//g,
    allowed: new Set(),
  },
]

const warningPatterns = [
  {
    name: 'Inline fontSize',
    regex: /fontSize\s*:/g,
  },
  {
    name: 'Hardcoded hex color',
    regex: /#[0-9a-fA-F]{3,8}\b/g,
  },
]

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'venv' || entry === '__pycache__') continue
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walk(full, files)
    else files.push(full)
  }
  return files
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length
}

function scanFiles(files, patterns, failOnMatch) {
  const findings = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      if (pattern.allowed?.has(file)) continue
      pattern.regex.lastIndex = 0
      let match
      while ((match = pattern.regex.exec(content))) {
        findings.push({
          severity: failOnMatch ? 'error' : 'warning',
          name: pattern.name,
          file: path.relative(root, file),
          line: lineOf(content, match.index),
        })
      }
    }
  }
  return findings
}

const missing = requiredFiles.filter((file) => !existsSync(path.join(root, file)))
assert.deepEqual(missing, [], `Missing required standards files: ${missing.join(', ')}`)

execFileSync(process.execPath, ['frontend/src/utils/formatters.test.js'], {
  cwd: root,
  stdio: 'inherit',
})

const uiFiles = walk(path.join(root, 'frontend/src')).filter((file) => /\.(jsx?|tsx?)$/.test(file))
const hardFailures = scanFiles(uiFiles, hardFailPatterns, true)
const warnings = scanFiles(
  uiFiles.filter((file) => /frontend\/src\/(pages|components)\//.test(file)),
  warningPatterns,
  false,
)

if (warnings.length) {
  console.warn(`Standards warnings recorded in docs/standards/CURRENT_VIOLATIONS.md: ${warnings.length}`)
  for (const item of warnings.slice(0, 20)) {
    console.warn(`warning ${item.name}: ${item.file}:${item.line}`)
  }
  if (warnings.length > 20) console.warn(`... ${warnings.length - 20} more warnings`)
}

if (hardFailures.length) {
  for (const item of hardFailures) {
    console.error(`error ${item.name}: ${item.file}:${item.line}`)
  }
  process.exit(1)
}

const layoutAuditFiles = [
  'frontend/src/pages/PropertiesPage.jsx',
  'frontend/src/pages/PropertyDetailPage.jsx',
  'frontend/src/pages/DashboardPage.jsx',
]
for (const file of layoutAuditFiles) {
  const content = readFileSync(path.join(root, file), 'utf8')
  const pageContainerUses = (content.match(/<PageContainer\b/g) || []).length
  const pageContainerCloses = (content.match(/<\/PageContainer>/g) || []).length
  assert.equal(pageContainerUses, 1, `${file} must use shared PageContainer exactly once`)
  assert.equal(pageContainerCloses, 1, `${file} must close shared PageContainer exactly once`)
}

const forbiddenLayoutTokens = {
  'frontend/src/pages/PropertyDetailPage.jsx': ['max-w-7xl mx-auto'],
  'frontend/src/pages/DashboardPage.jsx': ['-mx-6', '-mt-6', 'max-w-[100rem] mx-auto px-6 py-10'],
}
for (const [file, tokens] of Object.entries(forbiddenLayoutTokens)) {
  const content = readFileSync(path.join(root, file), 'utf8')
  for (const token of tokens) {
    assert.equal(content.includes(token), false, `${file} must not use local page layout token: ${token}`)
  }
}

console.log('standards check passed')
