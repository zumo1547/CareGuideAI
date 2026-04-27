import type { Metadata } from "next";
import { IBM_Plex_Mono, Sarabun } from "next/font/google";

import "./globals.css";

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["latin", "thai"],
  weight: ["300", "400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "CareGuideAI",
  description:
    "CareGuideAI - ระบบช่วยผู้พิการสแกนยา ติดตามเวลาใช้ยา และประสานงานคุณหมอแบบครบวงจร",
  icons: {
    icon: "/Logoweb/LogoWeb.png",
    shortcut: "/Logoweb/LogoWeb.png",
    apple: "/Logoweb/LogoWeb.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className={`${sarabun.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
