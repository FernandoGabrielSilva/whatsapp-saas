import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Minha aplicação",
  description: "App Next.js",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

