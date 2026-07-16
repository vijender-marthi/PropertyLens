export const PROPERTY_TAB_GROUPS = {
  analysis: 'Analysis',
  utility: 'Data/utility',
}

export const propertyTabs = [
  { id: 'summary', label: 'Summary', path: 'summary', group: 'analysis', icon: 'LayoutDashboard' },
  { id: 'loans', label: 'Loans', path: 'loans', group: 'analysis', icon: 'Landmark' },
  { id: 'rental', label: 'Rental', path: 'rental', group: 'analysis', icon: 'KeyRound' },
  { id: 'expenses', label: 'Expenses', path: 'expenses', group: 'analysis', icon: 'ReceiptText' },

  { id: 'taxes', label: 'Taxes', path: 'taxes', group: 'analysis', icon: 'ReceiptText' },
  { id: 'depreciation', label: 'Depreciation', path: 'depreciation', group: 'analysis', icon: 'TrendingDown' },
  { id: 'scenarios', label: 'Scenarios', path: 'scenarios', group: 'analysis', icon: 'SlidersHorizontal' },

  { id: 'documents', label: 'Documents', path: 'documents', group: 'utility', icon: 'Files' },
  { id: 'verify', label: 'Data health', path: 'verify', group: 'utility', icon: 'HeartPulse' },
  { id: 'checklist', label: 'Checklist', path: 'checklist', group: 'utility', icon: 'ListChecks' },
  { id: 'raw data', label: 'Raw data', path: 'raw-data', group: 'utility', icon: 'Table2' },
]
