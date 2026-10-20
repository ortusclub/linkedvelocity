import type { Metadata } from "next";
import RecoverView from "@/components/recover-view";
import styles from "../guide/primary-email/primary-email.module.css";

export const metadata: Metadata = { title: "Get your LinkedIn account back · LinkedVelocity", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Page() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.eyebrow}>LINKEDVELOCITY · ACCOUNT RECOVERY</div>
        <h1>Let&apos;s get your account back</h1>
        <p>Follow the steps below on your phone. It only takes a minute.</p>
      </header>
      <RecoverView />
    </main>
  );
}
