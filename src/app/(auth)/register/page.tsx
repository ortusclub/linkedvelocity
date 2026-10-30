import { getBrand } from "@/lib/brand";
import RegisterClient from "./register-form";

// Server wrapper: resolve the brand from the host so the signup header shows LinkedArmy or
// LinkedVelocity with no client-side flash (the form itself stays a client component).
export default async function RegisterPage() {
  const brand = await getBrand();
  const isArmy = brand.id === "linkedarmy";
  return (
    <RegisterClient
      brand={{
        isArmy,
        name: brand.name,
        logo: brand.logo,
        accent: isArmy ? "#ff7a59" : "#00B85C",
      }}
    />
  );
}
