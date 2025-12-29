import './globals.css'
import './brand.css'

export const metadata = {
  title: 'ODDScreener',
  description: 'ODDScreener - Your odds screening tool',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
