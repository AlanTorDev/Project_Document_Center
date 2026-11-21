import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Nunito_Sans } from "next/font/google";
import { ThemeProvider, type Theme } from "@/components/theme-provider";
import "./globals.css";

const nunitoSans = Nunito_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-nunito-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mộc — Personal Knowledge",
  description: "A calm, private home for your documents and ideas.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const initialTheme: Theme = cookieStore.get("moc-theme")?.value === "dark" ? "dark" : "light";
  return <html lang="vi" data-theme={initialTheme}><body className={nunitoSans.className}>
    <ThemeProvider initialTheme={initialTheme}>{children}</ThemeProvider>
  </body></html>;
}
