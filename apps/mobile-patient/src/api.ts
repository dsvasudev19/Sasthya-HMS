import { createApiClient } from '@hms/mobile-core'

export { API_URL, ApiError } from '@hms/mobile-core'
export const { api, tokenStore } = createApiClient('hms.patient.token')
