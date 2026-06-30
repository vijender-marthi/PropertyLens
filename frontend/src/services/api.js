import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (email, password) => {
    const form = new FormData()
    form.append('username', email)
    form.append('password', password)
    return axios.post('/api/auth/token', form)
  },
  me: () => api.get('/auth/me'),
}

// ── Properties ────────────────────────────────────────────────────────────────
export const propAPI = {
  list: () => api.get('/properties'),
  create: (data) => api.post('/properties', data),
  get: (id) => api.get(`/properties/${id}`),
  update: (id, data) => api.put(`/properties/${id}`, data),
  delete: (id) => api.delete(`/properties/${id}`),
  metrics: (id) => api.get(`/properties/${id}/metrics`),
  performance: (id) => api.get(`/properties/${id}/performance`),
  lifetime: (id) => api.get(`/properties/${id}/lifetime`),
  rawdata: (id) => api.get(`/properties/${id}/rawdata`),
  refreshValue: (id) => api.post(`/properties/${id}/refresh-value`),
  updateYearNote: (id, year, note) => api.patch(`/properties/${id}/year-note`, null, { params: { year, note } }),
  updateNotes: (id, note) => api.patch(`/properties/${id}/notes`, null, { params: { note } }),
  dashboard: () => api.get('/properties/dashboard/summary'),
  // Loans
  addLoan: (propId, data) => api.post(`/properties/${propId}/loans`, data),
  updateLoan: (propId, loanId, data) => api.put(`/properties/${propId}/loans/${loanId}`, data),
  deleteLoan: (propId, loanId) => api.delete(`/properties/${propId}/loans/${loanId}`),
  amortization: (propId, loanId, extra = 0) =>
    api.get(`/properties/${propId}/loans/${loanId}/amortization?extra_monthly=${extra}`),
  armSchedule: (propId, loanId) =>
    api.get(`/properties/${propId}/loans/${loanId}/arm-schedule`),
  // Tax return entries
  taxEntries: (propId) => api.get(`/properties/${propId}/tax-entries`),
  upsertYearEntry: (propId, data) => api.post(`/properties/${propId}/tax-entries`, data),
  taxComparison: () => api.get('/properties/tax-returns/comparison'),
  // Rental periods
  rentals: (propId) => api.get(`/properties/${propId}/rentals`),
  addRental: (propId, data) => api.post(`/properties/${propId}/rentals`, data),
  updateRental: (propId, rentalId, data) =>
    api.put(`/properties/${propId}/rentals/${rentalId}`, data),
  deleteRental: (propId, rentalId) =>
    api.delete(`/properties/${propId}/rentals/${rentalId}`),
}

// ── Documents ─────────────────────────────────────────────────────────────────
export const docAPI = {
  upload: (formData) =>
    api.post('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  list: (propertyId) => api.get(`/documents/property/${propertyId}`),
  listAll: () => api.get('/documents'),
  apply: (docId) => api.post(`/documents/${docId}/apply`),
  reparse: (docId) => api.post(`/documents/${docId}/reparse`),
  reprocessAll: () => api.post('/documents/reprocess-all'),
  markdown: (docId) => api.get(`/documents/${docId}/markdown`),
  delete: (docId) => api.delete(`/documents/${docId}`),
  deleteBatch: (ids) => api.post('/documents/delete-batch', { ids }),
}

// ── Sharing ───────────────────────────────────────────────────────────────────
export const sharingAPI = {
  list: () => api.get('/sharing'),
  share: (email) => api.post('/sharing', { email }),
  remove: (id) => api.delete(`/sharing/${id}`),
}

export default api
