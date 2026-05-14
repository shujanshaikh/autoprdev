import { createStart } from '@tanstack/react-start'
import { clerkMiddleware } from '@clerk/tanstack-react-start/server'

export const startInstance = createStart(() => ({
  requestMiddleware: [clerkMiddleware()],
}))
