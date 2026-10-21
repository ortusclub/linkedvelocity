// Detect off-platform DAILY rental payments straight from the TRON blockchain.
//
// Unlike the weekly rentals (one shared wallet, matched by amount), each daily
// renter pays USDT to their OWN unique TRON address — so we identify a payment by
// its recipient, not its amount. That means two renters paying the same $/day
// never collide. We simply sum everything received on the renter's address and
// divide by the daily rate to learn how many days they've funded.
//
// Read-only + public data (TronGrid): no exchange account, no private keys here.

import { fetchIncomingUsdt, type UsdtTransfer } from "@/lib/tron-payments";
import { daysCovered, dailyNextDue } from "@/lib/rental-tracker";

export interface DailyDetection {
  total: number;        // total USDT received on the address since tracking start
  daysPaid: number;     // whole days that total covers at `rate`/day
  nextDue: string;      // YYYY-MM-DD the next payment is due (start + daysPaid)
  lastTx: string | null; // most recent tx hash, if any
  transfers: UsdtTransfer[]; // every incoming transfer counted (newest first)
}

// Midnight-UTC ms for a YYYY-MM-DD string.
function dayMs(ymd: string): number {
  return Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
}

// Sum every USDT (TRC-20) transfer received on `address` since `from`, and derive
// how many days of a `rate`/day rental that covers.
export async function detectDailyPayment(
  address: string,
  rate: number,
  from: string
): Promise<DailyDetection> {
  const transfers = await fetchIncomingUsdt(address, { sinceTs: dayMs(from), limit: 200 });
  const total = transfers.reduce((s, t) => s + t.amount, 0);
  const daysPaid = daysCovered(total, rate);
  const nextDue = dailyNextDue(from, daysPaid);
  const lastTx = transfers.length ? transfers[0].txId : null; // TronGrid returns newest first
  return { total, daysPaid, nextDue, lastTx, transfers };
}
