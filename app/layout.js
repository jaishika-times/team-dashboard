import "./globals.css";

export const metadata = {
  title: "Team Dashboard",
  description: "Productivity and attendance tracking",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900 min-h-screen">{children}</body>
    </html>
  );
}
