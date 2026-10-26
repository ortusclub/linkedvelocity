"use client";

import { useParams } from "next/navigation";
import AccountEditForm from "@/components/admin/account-edit-form";

export default function EditAccountPage() {
  const params = useParams();
  return <AccountEditForm accountId={params.id as string} />;
}
