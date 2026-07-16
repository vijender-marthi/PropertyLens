import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { propertyTabs } from './propertyTabs.js'

assert.deepEqual(propertyTabs.map((tab) => tab.label), [
  'Summary',
  'Loans',
  'Rental',
  'Expenses',
  'Taxes',
  'Depreciation',
  'Scenarios',
  'Documents',
  'Data health',
  'Checklist',
  'Raw data',
])

assert.equal(propertyTabs.some((tab) => tab.id === 'details' || tab.label === 'Details' || tab.path === 'details'), false)
assert.equal(propertyTabs.some((tab) => tab.label === 'Usage'), false)
assert.equal(propertyTabs.every((tab) => Boolean(tab.icon)), true)
assert.deepEqual(propertyTabs.slice(0, 7).map((tab) => tab.group), Array(7).fill('analysis'))
assert.deepEqual(propertyTabs.slice(7).map((tab) => tab.group), Array(4).fill('utility'))
assert.deepEqual(propertyTabs.map((tab) => tab.icon), [
  'LayoutDashboard',
  'Landmark',
  'KeyRound',
  'ReceiptText',
  'ReceiptText',
  'TrendingDown',
  'SlidersHorizontal',
  'Files',
  'HeartPulse',
  'ListChecks',
  'Table2',
])

const dataHealthTab = propertyTabs.find((tab) => tab.id === 'verify')

assert.ok(dataHealthTab, 'verify tab id must remain available for existing deep links')
assert.equal(dataHealthTab.label, 'Data health')
assert.equal(dataHealthTab.path, 'verify')

const expensesTab = propertyTabs.find((tab) => tab.id === 'expenses')
assert.ok(expensesTab, 'expenses tab must be available after rental')
assert.equal(expensesTab.path, 'expenses')
assert.equal(propertyTabs[propertyTabs.findIndex((tab) => tab.id === 'rental') + 1].id, 'expenses')

const detailSource = readFileSync(new URL('../pages/PropertyDetailPage.jsx', import.meta.url), 'utf8')

assert.equal(detailSource.includes('function PropertyTabIcon'), true)
assert.equal(detailSource.includes('PROPERTY_TAB_ICONS'), true)
assert.equal(detailSource.includes('role="tablist"'), true)
assert.equal(detailSource.includes('role="tab"'), true)
assert.equal(detailSource.includes('aria-selected={isActive}'), true)
assert.equal(detailSource.includes('showSeparator'), true)
assert.equal(detailSource.includes('tabRefs.current[activeTab]?.scrollIntoView'), true)
assert.equal(detailSource.includes('tabBadgeFor'), true)
assert.equal(detailSource.includes('edit#expenses'), false)
assert.equal(detailSource.includes('propAPI.upsertAnnualExpense'), true)
assert.equal(detailSource.includes('Upload the mortgage statement from Documents'), false)
assert.equal(detailSource.includes('docAPI.loanStatementReview'), true)
