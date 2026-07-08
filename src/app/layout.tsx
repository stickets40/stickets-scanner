import type { Metadata, Viewport } from "next";
import "@/styles/globals.css";
import { PwaProvider } from "@/components/ui/pwa-provider";

export const metadata: Metadata = {
  title: "Stickets Scanner",
  description: "QR code ticket scanner for Stickets events",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Stickets Scanner",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1B1B3C",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background">
        <PwaProvider />
        {children}
      </body>
    </html>
  );
}
