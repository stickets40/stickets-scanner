import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@/styles/globals.css";
import { AppProviders } from "@/components/ui/app-providers";

export const metadata: Metadata = {
  title: "Stickets Scanner",
  description: "QR code ticket scanner for Stickets events",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stickets Scanner",
  },
  // iOS ignores the web manifest's icons on older versions, falling back to a
  // page screenshot for the home-screen tile. This app's whole distribution
  // model is "install to home screen", so declare the touch icon explicitly.
  icons: {
    icon: "/icons/icon-192x192.png",
    apple: "/icons/icon-192x192.png",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale / userScalable are deliberately NOT set. Blocking pinch-zoom
  // fails WCAG 1.4.4, and an operator squinting at a name in a dark doorway is
  // exactly the person who needs to zoom.
  viewportFit: "cover",
  // Matches --color-surface-0 so the system chrome doesn't seam against the app.
  themeColor: "#100c0b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-surface-0 text-ink">
        <AppProviders />
        {children}
      </body>
    </html>
  );
}
