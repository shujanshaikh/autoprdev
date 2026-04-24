import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

import "../index.css";
import { Oxanium, Source_Code_Pro } from "next/font/google";

import Providers from "@/components/providers";

const oxanium = Oxanium({
  variable: "--font-oxanium",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
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
      <body className={`${oxanium.variable} ${sourceCodePro.variable} antialiased`}>
        <ClerkProvider>
          <Providers>
            <div className="flex min-h-svh min-h-0 flex-1 flex-col overflow-x-clip">{children}</div>
          </Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
