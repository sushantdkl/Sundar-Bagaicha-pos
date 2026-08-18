import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth-context'
import { ToastProvider } from '@/components/ui/toast'
import { ConfirmProvider } from '@/components/ui/confirm'
import { RESTAURANT } from '@/lib/restaurant-info.js'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

const SITE_DESCRIPTION = `${RESTAURANT.tagline}. Call ${RESTAURANT.phoneDisplay}.`

// Bump `v` whenever the favicon assets change to bust browser/CDN caches.
const ICON_VERSION = '2083b'

export const metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || RESTAURANT.siteUrl),
  title: {
    default: `${RESTAURANT.name} | ${RESTAURANT.tagline}`,
    template: `%s | ${RESTAURANT.name}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: RESTAURANT.name,
  manifest: `/site.webmanifest?v=${ICON_VERSION}`,
  icons: {
    icon: [
      { url: `/favicon.ico?v=${ICON_VERSION}`, sizes: 'any' },
      { url: `/icon-light-32x32.png?v=${ICON_VERSION}`, type: 'image/png', sizes: '32x32' },
    ],
    apple: [{ url: `/apple-icon.png?v=${ICON_VERSION}`, sizes: '180x180' }],
    shortcut: [{ url: `/favicon.ico?v=${ICON_VERSION}` }],
  },
  openGraph: {
    type: 'website',
    siteName: RESTAURANT.name,
    title: `${RESTAURANT.name} | ${RESTAURANT.tagline}`,
    description: SITE_DESCRIPTION,
    images: [{ url: RESTAURANT.logo, alt: RESTAURANT.name }],
  },
  twitter: {
    card: 'summary',
    title: RESTAURANT.name,
    description: SITE_DESCRIPTION,
    images: [RESTAURANT.logo],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
  },
}

export const viewport = {
  themeColor: RESTAURANT.themeColor,
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              const theme = localStorage.getItem('theme') || 'light';
              if (theme === 'dark') {
                document.documentElement.classList.add('dark');
              }
            })();
          `
        }} />
      </head>
      <body className={`font-sans antialiased`}>
        <AuthProvider>
          <ToastProvider>
            <ConfirmProvider>
              {children}
            </ConfirmProvider>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
