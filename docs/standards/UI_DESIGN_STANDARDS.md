# PropertyLens UI Design Standards

PropertyLens is a professional, minimal, financial, data-first application. Interfaces must be consistent, compact, auditable, and easy to scan.

Avoid heavy gradients, excessive animations, glassmorphism, decorative charts, large empty cards, page-specific visual styles, and inconsistent metric formatting.

## 1. Typography

Use only the approved application font family and shared typography tokens or approved utility classes.

Required typography roles:

- `display`
- `pageTitle`
- `sectionTitle`
- `cardTitle`
- `body`
- `bodyStrong`
- `label`
- `caption`
- `metricLarge`
- `metricMedium`
- `metricSmall`

Components must not introduce arbitrary font sizes, inline font styles, or page-specific font families. Disallowed examples:

- `font-size: 17px`
- `font-size: 19px`
- `style={{ fontSize: 11 }}`
- Page-specific font-family declarations

## 2. Colors

Components must use design tokens or approved utility classes. Hardcoded color values in components should not be added.

Approved semantic color roles:

- `background`
- `surface`
- `border`
- `textPrimary`
- `textSecondary`
- `primary`
- `success`
- `warning`
- `danger`
- `info`
- `muted`

Do not use color as the only status indicator. Pair severity color with text, icon, or status label.

## 3. Spacing

Use the shared spacing scale:

- `4`
- `8`
- `12`
- `16`
- `24`
- `32`
- `48`

Avoid arbitrary one-off spacing unless the reason is documented in the component.

## 4. Shared Components

Before creating a new component, check for existing shared components, including:

- `MetricCard`
- `SummaryCard`
- `DataTable`
- `FormField`
- `CurrencyInput`
- `PercentInput`
- `DateInput`
- `InfoTooltip`
- `StatusBadge`
- `EmptyState`
- `ErrorState`
- `ChartCard`
- `Modal`
- `Drawer`
- `Tabs`
- `LoanCard`
- `PropertyCard`

Duplicate components are prohibited. Extend the shared component when a reusable pattern is missing.

## 5. Global Number Formatting

The approved frontend formatter module is:

- `frontend/src/utils/formatters.js`

All pages, components, tables, charts, tooltips, dialogs, and export adapters must use the shared formatter where frontend display formatting is appropriate.

Approved functions:

- `formatCurrency()`
- `formatCurrencyCompact()`
- `formatMetricCurrency()`
- `formatMonthlyCurrency()`
- `formatNumber()`
- `formatInteger()`
- `formatPercent()`
- `formatInterestRate()`
- `formatDate()`
- `formatYear()`
- `formatChartNumber()`
- `formatChartCurrency()`
- `rawExportValue()`

Do not call `Intl.NumberFormat`, `.toLocaleString()`, or `.toFixed()` directly in UI components for display.

### Cards, Dashboard Metrics, and KPIs

Absolute currency values greater than or equal to `100,000` use compact notation.

Examples:

- `100000` -> `$100K`
- `456201` -> `$456K`
- `700000` -> `$700K`
- `965313` -> `$965K`
- `1210000` -> `$1.2M`
- `1800000` -> `$1.8M`

Values below `100,000` remain full unless a component explicitly uses chart formatting.

Examples:

- `7890` -> `$7,890`
- `38400` -> `$38,400`

### Tables

All table values use full formatting:

- `$1,210,000`
- `$1,800,000`
- `$834,687`
- `$16,401`

Never use compact K/M/B values in tables.

### Charts

Axis labels use compact formatting. Tooltips use full precision.

### Exports

CSV, XLSX, JSON, and downloadable datasets always use raw or full numeric values. Never export strings such as `$965K`; export `965313`.

### Loan Interest Rates

Loan interest rates always show exactly three decimals:

- `2.875%`
- `5.000%`
- `6.250%`
- `7.125%`

### Other Percentages

Percentages show up to two decimals and trim unnecessary trailing zeros:

- `5%`
- `5.2%`
- `46.37%`

### Negative Currency

Use `-$16,401`. Do not use `($16,401)` unless accounting display is explicitly approved.

### Empty Values

Use `—` for null, undefined, empty, or missing values. Do not replace a real numeric zero with an em dash.

## 6. Year and Table Standards

Whenever a table contains a `Year` field:

- Default sort is ascending.
- Oldest year appears first.
- Secondary sort is Statement Date ascending when available.

All data tables must use the shared DataTable implementation when available.

Required table capabilities:

- Sorting
- Filtering
- Search
- Sticky header
- Horizontal scrolling
- Column visibility
- Export current view
- Export all data
- Responsive behavior
- Pagination or virtualization for large datasets

Do not create custom static table implementations unless formally approved.

### Raw Data Page

- Use spreadsheet-style table format.
- Keep one consistent set of columns.
- Support grouping by None, Document Type, Year, and Document Type + Year.
- Grouping must not change the tabular column layout.
- No year comparison or pivot mode unless separately approved.

## 7. Form Standards

All forms must use shared field components where available.

Required behavior:

- Stable input focus
- Controlled numeric parsing
- Validation
- Dirty state
- Save
- Cancel
- Error summary
- Loading state
- Consistent labels
- Consistent help text
- Keyboard support

Do not reformat numeric input on every keystroke in a way that causes cursor movement or focus loss. Formatting should occur on blur, on submit, or in a separate display layer.

## 8. Accessibility

All UI work must include:

- Keyboard access
- Visible focus states
- Semantic headings
- Accessible labels for controls
- Text labels alongside status color
- Screen-reader-safe loading and error states
- Responsive layouts that remain usable on mobile

