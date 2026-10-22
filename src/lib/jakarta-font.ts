import localFont from "next/font/local";

// Bundled from google/fonts under OFL; avoids extensionless Google CSS URLs.
export const jakartaSans = localFont({
  src: "../fonts/PlusJakartaSans.ttf",
  weight: "200 800",
  display: "swap",
  variable: "--font-sans",
});

export const jakartaToken = localFont({
  src: "../fonts/PlusJakartaSans.ttf",
  weight: "200 800",
  display: "swap",
  variable: "--font-jak",
});
