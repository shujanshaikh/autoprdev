import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';
import { TanStackDevtools } from '@tanstack/react-devtools';
import { useEffect } from 'react';

import appCss from '../styles.css?url'
import landingCss from '../landing.css?url'
import { Providers } from '../providers';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'autopr',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'stylesheet',
        href: landingCss,
      },
      {
        rel: 'icon',
        href: '/favicon.ico',
        sizes: '32x32',
      },
      {
        rel: 'icon',
        type: 'image/png',
        href: '/logo192.png',
        sizes: '192x192',
      },
      {
        rel: 'apple-touch-icon',
        href: '/apple-touch-icon.png',
      },
      {
        rel: 'manifest',
        href: '/manifest.json',
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function NotFound() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16">
      <section className="mx-auto max-w-md text-center">
        <p className="type-mono-label uppercase text-muted-foreground">404</p>
        <h1 className="type-card-heading mt-3 text-foreground">Page not found</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The page you’re looking for doesn’t exist or may have moved.
        </p>
        <Link
          to="/"
          className="type-button mt-8 inline-flex h-10 items-center justify-center rounded-[var(--radius-pill)] bg-primary px-6 text-primary-foreground shadow-none transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          Back to home
        </Link>
      </section>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      void import('react-grab')
    }
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <Providers>{children}</Providers>
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  )
}
