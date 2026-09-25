import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@platform/ui/app-shell";

export const metadata: Metadata = {
  title: "Internal Tools Platform",
  description: "Reusable platform for internal applications",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
