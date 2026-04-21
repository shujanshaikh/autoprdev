import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "../index.css";
import { Geist, Geist_Mono } from "next/font/google";

import Providers from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ClerkProvider>
          <Providers>
            <div className="flex min-h-svh min-h-0 flex-1 flex-col overflow-x-clip">{children}</div>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
