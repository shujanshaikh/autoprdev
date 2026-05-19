import { Toaster } from '@autopr/ui/components/sonner'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthKitProvider, useAccessToken, useAuth } from '@workos/authkit-tanstack-react-start/client'
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react'
import { useCallback, useMemo, useState } from 'react'

import { ThemeProvider } from './components/theme-provider'

const convexUrl = import.meta.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error('Missing VITE_CONVEX_URL in your web environment')
}

const convex = new ConvexReactClient(convexUrl)

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )

  return (
    <AuthKitProvider>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuthKit}>
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ConvexProviderWithAuth>
        <Toaster richColors />
      </ThemeProvider>
    </AuthKitProvider>
  )
}

function useAuthFromAuthKit() {
  const { loading, user } = useAuth()
  const { getAccessToken, refresh } = useAccessToken()

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken?: boolean } = {}) => {
      if (!user) return null
      return (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null
    },
    [getAccessToken, refresh, user],
  )

  return useMemo(
    () => ({
      isLoading: loading,
      isAuthenticated: Boolean(user),
      fetchAccessToken,
    }),
    [fetchAccessToken, loading, user],
  )
}
