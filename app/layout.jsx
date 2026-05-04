import "./globals.css";

export const metadata = {
  title: "SK T ZONE — Admin Reconciliation Hub",
  description: "SK T ZONE admin reconciliation dashboard for cash flow operations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
