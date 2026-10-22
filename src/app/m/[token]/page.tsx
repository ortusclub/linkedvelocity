import { jakartaToken as jakarta } from "@/lib/jakarta-font";
import { Space_Grotesk } from "next/font/google";
import Portal from "./Portal";

const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-gro" });

export const metadata = { title: "Your Referral Dashboard · LinkedVelocity" };

export default async function MarketerPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className={`${jakarta.variable} ${grotesk.variable}`}>
      <Portal token={token} />
    </div>
  );
}
