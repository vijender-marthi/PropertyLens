export function parseMoney(value) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export function costModel(values = {}, loans = []) {
  const usage = String(values.usage_type || values.usage || '').toLowerCase()
  const isRental = usage === 'rental'
  const loanPayments = (loans || []).reduce((sum, loan) => sum + parseMoney(loan.monthly_payment ?? loan.monthlyPI), 0)
  const propertyTaxMo = parseMoney(values.property_tax ?? values.propertyTaxPerYear) / 12
  const insuranceMo = parseMoney(values.insurance ?? values.insuranceMonthly)
  const hoaMo = parseMoney(values.hoa_fee ?? values.hoaMonthly) + (parseMoney(values.hoa_special_assessment ?? values.hoaSpecialAssessment) / 12)
  const otherMo = parseMoney(values.maintenance)
    + parseMoney(values.utilities)
    + parseMoney(values.capex_reserve ?? values.capExReserve)
    + parseMoney(values.other_expenses ?? values.otherExpenses)
    + (isRental ? parseMoney(values.property_management_fee ?? values.propertyManagement) : 0)
    + (String(values.solar_ownership || '') === 'Leased' ? parseMoney(values.solar_monthly_payment) : 0)
  const monthlyOutflow = loanPayments + propertyTaxMo + insuranceMo + hoaMo + otherMo
  const grossRentMo = parseMoney(values.monthly_rent ?? values.monthlyRent)
  const vacancyRaw = parseMoney(values.vacancy_allowance ?? values.vacancyAllowance)
  const vacancyMo = isRental && vacancyRaw > 0 && vacancyRaw <= 100
    ? grossRentMo * (vacancyRaw / 100)
    : (isRental ? vacancyRaw : 0)
  const effectiveRent = isRental ? Math.max(0, grossRentMo - vacancyMo) : 0
  const monthly = isRental ? effectiveRent - monthlyOutflow : monthlyOutflow
  return {
    label: isRental ? 'Monthly cash flow' : 'Monthly cost to own',
    monthly,
    annual: monthly * 12,
    monthlyOutflow,
    effectiveRent,
    breakdown: {
      loanPayments,
      propertyTaxMo,
      insuranceMo,
      hoaMo,
      otherMo,
      grossRentMo,
      vacancyMo,
    },
  }
}
