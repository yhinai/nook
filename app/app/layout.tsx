import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nook — Your personal council",
  description: "Your own space to think. Talk with Nook, explore different perspectives, and return to the next steps that matter.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
