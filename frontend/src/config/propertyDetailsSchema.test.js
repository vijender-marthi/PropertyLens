import assert from 'node:assert/strict'
import { propertyDetailsSections, propertyIdentitySections } from './propertyDetailsSchema.js'

assert.deepEqual(propertyIdentitySections.map((section) => section.title), [
  'Property',
  'Location',
  'Purchase & Value',
  'System Information',
])

assert.deepEqual(propertyDetailsSections.map((section) => section.title), [
  'Property',
  'Location',
  'Purchase & Value',
  'System Information',
  'Rental',
  'Taxes & Expenses',
])

const fieldIds = propertyIdentitySections.flatMap((section) => section.fields.map((field) => field.id))

assert.equal(fieldIds.includes('property_uid'), false)
assert.equal(fieldIds.includes('county'), false)
assert.equal(fieldIds.includes('apn'), false)
assert.equal(fieldIds.includes('parcel_number'), false)
assert.equal(fieldIds.includes('legal_description'), false)
assert.equal(fieldIds.includes('solar_ownership'), false)
assert.equal(fieldIds.includes('tenant_name'), false)
assert.equal(fieldIds.includes('original_residency_status'), true)
assert.equal(propertyIdentitySections[0].fields.find((field) => field.id === 'property_type')?.label, 'Home Type')
assert.equal(typeof propertyIdentitySections[0].fields.find((field) => field.id === 'property_type')?.formatter, 'function')
assert.equal(propertyIdentitySections[0].fields.find((field) => field.id === 'property_type')?.formatter('single_family', {}), 'Single Family')
assert.equal(propertyIdentitySections[0].fields.find((field) => field.id === 'property_type')?.formatter('other', { property_type_raw: 'Carriage House' }), 'Carriage House')
assert.equal(fieldIds.includes('property_type_raw'), true)
assert.equal(propertyIdentitySections[0].fields.find((field) => field.id === 'usage_type')?.label, 'Current Residency Status')
assert.equal(propertyIdentitySections[0].fields.find((field) => field.id === 'original_residency_status')?.label, 'Original Residency Status')
assert.equal(fieldIds.includes('closing_costs'), true)
assert.equal(fieldIds.includes('market_value_source'), true)
assert.equal(fieldIds.includes('createdAt'), true)
assert.equal(fieldIds.includes('updatedAt'), true)
assert.equal(propertyIdentitySections.find((section) => section.id === 'system_information')?.fields[0].label, 'Added to PropertyLens')
assert.equal(propertyIdentitySections.find((section) => section.id === 'system_information')?.fields[1].label, 'Last Updated')
assert.equal(propertyIdentitySections.find((section) => section.id === 'system_information')?.fields[1].formatter, 'datetime')

assert.deepEqual(
  propertyDetailsSections.find((section) => section.id === 'rental')?.fields.map((field) => field.id),
  ['monthly_rent', 'rental_start_date', 'occupancy_rate']
)
