import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectBackendAcquisitionDocument } from './propertySetupPresentation.js'

const documents = [
  { id: 10, original_filename: 'refinance.pdf' },
  { id: 4, original_filename: 'purchase.pdf' },
]

assert.equal(selectBackendAcquisitionDocument(
  documents,
  { acquisition: { selectedDocumentId: 4 } },
)?.original_filename, 'purchase.pdf')
assert.equal(selectBackendAcquisitionDocument(documents, { acquisition: null }), null)
assert.equal(selectBackendAcquisitionDocument(documents, { acquisition: { selectedDocumentId: 99 } }), null)

const pageSource = readFileSync(new URL('../pages/PropertyFormPage.jsx', import.meta.url), 'utf8')
assert.equal(pageSource.includes('selectBackendAcquisitionDocument(setupDocuments, lifecycleResponse.data)'), true)
assert.equal(pageSource.includes('Statement final total'), false)
