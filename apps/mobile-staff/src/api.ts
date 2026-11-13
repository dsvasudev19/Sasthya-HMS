import { createApiClient } from '@hms/mobile-core'

export { ApiError } from '@hms/mobile-core'

let lost: (() => void) | null = null
export const onSessionLost = (fn: () => void) => { lost = fn }
export const { api, tokenStore, refreshStore } = createApiClient('hms.staff.token', { refreshPath: '/auth/refresh', onSessionLost: () => lost?.() })
