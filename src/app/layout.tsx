import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { db } from "@/server/db";
import { logoUrl } from "@/server/services/branding";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export async function generateMetadata(): Promise<Metadata> {
  const company = await db.company.findFirst({ select: { logoPath: true, updatedAt: true } }).catch(() => null);
  const icon = (company && logoUrl(company)) ?? "/favicon-dot.svg";
  return {
    title: { default: "RFS HCM", template: "%s · RFS HCM" },
    description: "HR, attendance and payroll — Red Feather Solutions (RFS) (Private) Limited",
    robots: { index: false, follow: false },
    icons: { icon, apple: icon },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
