export const propertyLabel = (property, fallback = 'Property') => {
  if (!property) return fallback
  return property.name || property.address?.split(',')[0] || fallback
}

export const shortPropertyUid = (property) => {
  if (!property?.property_uid) return ''
  return property.property_uid.slice(0, 8).toUpperCase()
}
