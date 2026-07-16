import { homeTypeLabel } from './propertySetupPresentation.js'

export const propertyIdentitySections = [
  {
    id: 'property',
    title: 'Property',
    fields: [
      { id: 'name', label: 'Property name', required: true },
      { id: 'property_type', label: 'Home Type', required: true, formatter: (value, property) => homeTypeLabel(value, property?.property_type_raw) },
      { id: 'property_type_raw', label: 'Other Home Type', showWhen: (property) => property?.property_type === 'other' && Boolean(property?.property_type_raw) },
      { id: 'original_residency_status', label: 'Original Residency Status', required: true },
      { id: 'usage_type', label: 'Current Residency Status', required: true },
    ],
  },
  {
    id: 'location',
    title: 'Location',
    fields: [
      { id: 'address', label: 'Street address' },
      { id: 'city', label: 'City' },
      { id: 'state', label: 'State' },
      { id: 'zip_code', label: 'ZIP' },
    ],
  },
  {
    id: 'purchase_value',
    title: 'Purchase & Value',
    fields: [
      { id: 'purchase_date', label: 'Purchase date', formatter: 'date' },
      { id: 'purchase_price', label: 'Purchase price', formatter: 'currency' },
      { id: 'down_payment', label: 'Down payment', formatter: 'currency' },
      { id: 'closing_costs', label: 'Closing costs', formatter: 'currency' },
      { id: 'market_value', label: 'Current value', formatter: 'currency' },
      { id: 'market_value_source', label: 'Valuation source', hideValues: ['manual'] },
      { id: 'market_value_updated', label: 'Valuation date', formatter: 'date' },
    ],
  },
  {
    id: 'system_information',
    title: 'System Information',
    fields: [
      { id: 'createdAt', label: 'Added to PropertyLens', formatter: 'date' },
      { id: 'updatedAt', label: 'Last Updated', formatter: 'datetime' },
    ],
  },
]

export const propertyDetailsSections = [
  ...propertyIdentitySections,
  {
    id: 'rental',
    title: 'Rental',
    fields: [
      { id: 'monthly_rent', label: 'Monthly rent', formatter: 'currency', appliesTo: ['rental', 'mixed'] },
      { id: 'rental_start_date', label: 'Rental start date', formatter: 'date', appliesTo: ['rental', 'mixed'] },
      { id: 'occupancy_rate', label: 'Occupancy rate', formatter: 'percent', appliesTo: ['rental', 'mixed'], showZero: true },
    ],
  },
  {
    id: 'taxes_expenses',
    title: 'Taxes & Expenses',
    fields: [
      { id: 'insurance', label: 'Insurance', formatter: 'currency' },
      { id: 'property_tax', label: 'Property tax', formatter: 'currency' },
      { id: 'hoa_fee', label: 'HOA', formatter: 'currency' },
      { id: 'maintenance', label: 'Repairs & maintenance', formatter: 'currency' },
      { id: 'property_management_fee', label: 'Property management', formatter: 'currency', appliesTo: ['rental', 'mixed'] },
      { id: 'utilities', label: 'Utilities', formatter: 'currency' },
      { id: 'vacancy_allowance', label: 'Vacancy allowance', formatter: 'currency', appliesTo: ['rental', 'mixed'] },
      { id: 'capex_reserve', label: 'CapEx reserve', formatter: 'currency' },
      { id: 'other_expenses', label: 'Other expenses', formatter: 'currency' },
    ],
  },
]

export function propertyDetailsSectionTitle(id) {
  if (id === 'misc_solar') return 'Misc / Solar'
  return propertyDetailsSections.find((section) => section.id === id)?.title || id
}
