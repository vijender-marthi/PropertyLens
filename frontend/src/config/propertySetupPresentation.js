export const propertySetupSections = [
  {
    id: 'property',
    title: 'Property',
    icon: 'Home',
    subtitle: 'Basic information, purchase details and valuation.',
  },
  {
    id: 'financing',
    title: 'Loans',
    icon: 'Landmark',
    subtitle: 'Mortgage and loan information.',
  },
  {
    id: 'rental',
    title: 'Rental',
    icon: 'KeyRound',
    subtitle: 'Rental history and occupancy.',
  },
  {
    id: 'expenses',
    title: 'Expenses',
    icon: 'Receipt',
    subtitle: 'Annual ownership expenses.',
  },
]

export const propertySetupSectionIds = propertySetupSections.map((section) => section.id)

export function selectBackendAcquisitionDocument(documents, lifecycle) {
  const selectedDocumentId = lifecycle?.acquisition?.selectedDocumentId
  if (!selectedDocumentId) return null
  return (documents || []).find((document) => document.id === selectedDocumentId) || null
}

const acquisitionSourceTargets = {
  closing_date: 'purchase_date',
  purchase_price: 'purchase_price',
  borrower_paid_closing_costs: 'closing_costs',
  down_payment: 'down_payment',
  settlement_accounting_total: 'settlement_accounting_total',
}

export function acquisitionFieldSources(lifecycle) {
  return (lifecycle?.acquisition?.selectedFields || []).reduce((sources, field) => {
    const targetKey = acquisitionSourceTargets[field.key || field.field]
    if (!targetKey || !field.documentId) return sources
    const sourceLabel = field.sourceLabel || 'Source document'
    sources[targetKey] = {
      label: `from ${sourceLabel}`,
      tone: 'reported',
      title: `${sourceLabel} source details`,
      documentId: field.documentId,
      documentName: field.sourceDocument,
      page: field.page,
      confidence: field.confidence,
      selectionType: field.selectionType,
      sourceField: field.field,
    }
    return sources
  }, {})
}

export const propertySetupFlagRows = [
  {
    id: 'hasFinancing',
    title: 'Loan',
    helper: 'Adds financing and debt details',
    icon: 'Landmark',
  },
  {
    id: 'hasHoa',
    title: 'HOA',
    helper: 'Shows HOA expense fields',
    icon: 'Receipt',
  },
  {
    id: 'hasSolar',
    title: 'Solar',
    helper: 'Shows solar-related fields',
    icon: 'Calculator',
  },
]

export const propertySetupFieldPresentation = {
  name: {
    emphasis: true,
    helper: 'Use the name you recognize across dashboards.',
  },
  address: {
    span: 'md:col-span-2',
  },
  state: {
    span: 'md:col-span-1 lg:col-span-1',
  },
  zip_code: {
    span: 'md:col-span-1 lg:col-span-1',
  },
  purchase_price: {
    emphasis: true,
    helper: 'Original contract price, excluding later improvements.',
  },
  down_payment: {
    helper: 'Cash contribution at purchase.',
  },
  market_value: {
    emphasis: true,
    helper: 'Backend estimate using 6% annual appreciation, or a manual override.',
  },
  market_value_source: {
    helper: 'Automatic 6% estimate, manual, appraisal, or imported value.',
  },
}

export const HOME_TYPE_OPTIONS = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'condominium', label: 'Condominium' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'triplex', label: 'Triplex' },
  { value: 'fourplex', label: 'Fourplex' },
  { value: 'multi_family', label: 'Multi-Family' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'manufactured_home', label: 'Manufactured Home' },
  { value: 'mobile_home', label: 'Mobile Home' },
  { value: 'cooperative', label: 'Cooperative' },
  { value: 'vacation_home', label: 'Vacation Home' },
  { value: 'mixed_use_property', label: 'Mixed-Use Property' },
  { value: 'commercial_residential', label: 'Commercial Residential' },
  { value: 'land', label: 'Land' },
  { value: 'other', label: 'Other' },
]

const HOME_TYPE_ALIASES = {
  single_family: 'single_family',
  'single family': 'single_family',
  'single-family': 'single_family',
  sfr: 'single_family',
  condominium: 'condominium',
  condo: 'condominium',
  townhouse: 'townhouse',
  townhome: 'townhouse',
  duplex: 'duplex',
  triplex: 'triplex',
  fourplex: 'fourplex',
  '4plex': 'fourplex',
  multi_family: 'multi_family',
  'multi family': 'multi_family',
  'multi-family': 'multi_family',
  multifamily: 'multi_family',
  apartment: 'apartment',
  apartments: 'apartment',
  manufactured_home: 'manufactured_home',
  'manufactured home': 'manufactured_home',
  mobile_home: 'mobile_home',
  'mobile home': 'mobile_home',
  cooperative: 'cooperative',
  co_op: 'cooperative',
  'co-op': 'cooperative',
  vacation_home: 'vacation_home',
  'vacation home': 'vacation_home',
  mixed_use_property: 'mixed_use_property',
  'mixed-use property': 'mixed_use_property',
  'mixed use property': 'mixed_use_property',
  commercial_residential: 'commercial_residential',
  'commercial residential': 'commercial_residential',
  commercial: 'commercial_residential',
  land: 'land',
  other: 'other',
}

export function normalizeHomeType(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return HOME_TYPE_ALIASES[normalized] || (normalized ? 'other' : 'single_family')
}

export function homeTypeLabel(value, rawValue = '') {
  const normalized = normalizeHomeType(value)
  if (normalized === 'other' && rawValue) return rawValue
  return HOME_TYPE_OPTIONS.find((option) => option.value === normalized)?.label || HOME_TYPE_OPTIONS[0].label
}
