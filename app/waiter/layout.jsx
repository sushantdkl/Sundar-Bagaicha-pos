// Own manifest so "Add to Home Screen" from any /waiter page launches straight
// back into /waiter (not the public site homepage) as a standalone app icon.
export const metadata = {
  manifest: '/waiter-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Waiter',
  },
}

export default function WaiterLayout({ children }) {
  return children
}
