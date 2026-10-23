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
      { url: "/icon.svg?v=2", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png?v=2", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png?v=2", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180" },
      { url: "/icons/apple-touch-icon-167.png?v=2", sizes: "167x167" },
      { url: "/icons/apple-touch-icon-152.png?v=2", sizes: "152x152" },
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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        {/* iOS 26+ home-screen apps draw a system blur below the status bar that reaches down over the header.
            A solid fixed bar at the very top (>= 6px tall, full width) makes iOS paint an opaque status bar instead. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(navigator.standalone||matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: fullscreen)').matches)document.documentElement.classList.add('standalone')}catch(e){}",
          }}
        />
        <div aria-hidden className="status-bar-cover" data-testid="status-bar-cover" />
        {children}
      </body>
    </html>
  );
}
