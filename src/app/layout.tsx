import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#18181b" };

export const metadata: Metadata = {
  title: "MoveMentor: free chess game review",
  description:
    "MoveMentor: free, open-source chess game review. Stockfish runs in your browser, with move classifications, coach explanations and engine lines.",
  applicationName: "MoveMentor",
  appleWebApp: { capable: true, title: "MoveMentor", statusBarStyle: "black-translucent" },
  other: { "apple-mobile-web-app-capable": "yes" }, // older iOS ignores the manifest display mode
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
      { url: "/icons/apple-touch-icon-167.png", sizes: "167x167" },
      { url: "/icons/apple-touch-icon-152.png", sizes: "152x152" },
    ],
  },
  openGraph: {
    title: "MoveMentor",
    description: "Free, open-source chess game review powered by Stockfish in your browser.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
