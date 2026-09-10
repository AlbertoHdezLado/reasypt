import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ViewportZoomLock } from "@/components/ViewportZoomLock";
import { getRequestLocale, getRequestMessages } from "@/lib/server-locale";
import "./globals.css";

const appSans = Plus_Jakarta_Sans({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const appMono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getRequestMessages();

  return {
    title: "reasypt",
    description: messages.metadata.description,
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "reasypt",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  const messages = await getRequestMessages();

  return (
    <html
      lang={locale}
      className={`${appSans.variable} ${appMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        <ViewportZoomLock />
        <OfflineBanner message={messages.room.offline} />
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}