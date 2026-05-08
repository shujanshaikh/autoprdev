import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "../index.css";
import { DM_Sans, DM_Mono } from "next/font/google";

import Providers from "@/components/providers";
import Script from "next/dist/client/script";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "autopr",
  description:
    "Long-running coding agents in isolated sandboxes. Pay only for sandbox time. Bring your own Codex subscription — no API markup.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>

        <body className={`${dmSans.variable} ${dmMono.variable} antialiased`}>
        <ClerkProvider>
          <Providers>
            <div className="flex min-h-svh min-h-0 flex-1 flex-col overflow-x-clip">{children}</div>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
