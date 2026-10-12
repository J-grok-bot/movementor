import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "MoveMentor: free chess game review",
  description:
    "MoveMentor: free, open-source chess game review. Stockfish runs in your browser, with move classifications, coach explanations and engine lines.",
  applicationName: "MoveMentor",
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
