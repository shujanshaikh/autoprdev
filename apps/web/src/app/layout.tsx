import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "../index.css";
import { Chakra_Petch, IBM_Plex_Mono } from "next/font/google";

import Providers from "@/components/providers";

const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "autopr — cloud-native coding agents",
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
      <body className={`${chakraPetch.variable} ${ibmPlexMono.variable} antialiased`}>
        <ClerkProvider>
          <Providers>
            <div className="flex min-h-svh min-h-0 flex-1 flex-col overflow-x-clip">{children}</div>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
