import "./globals.css";

export const metadata = {
  title: "SK T ZONE — Admin Reconciliation Hub",
  description: "SK T ZONE admin reconciliation dashboard for cash flow operations.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
