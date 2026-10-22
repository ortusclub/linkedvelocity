import { ethers } from "ethers";

// Native USDC on Base only. Never authorize an arbitrary configured token.
export const SPONSORED_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHAIN_ID = 8453;
const ORACLE = "0x420000000000000000000000000000000000000F";
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] };
const abi = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
];

export function sponsorshipEnabled() { return process.env.USDC_GAS_SPONSOR_ENABLED === "true"; }

function config() {
  const address = process.env.GAS_SPONSOR_ADDRESS?.trim();
  const key = process.env.GAS_SPONSOR_PRIVATE_KEY?.trim();
  if (!address || !ethers.isAddress(address) || address === ethers.ZeroAddress || !key) {
    throw new Error("Configure the central gas wallet address and signing key.");
  }
  const maxFee = ethers.parseEther(process.env.GAS_SPONSOR_MAX_FEE_ETH || "0.00001");
  if (maxFee <= BigInt(0) || maxFee > ethers.parseEther("0.001")) throw new Error("Invalid gas fee limit.");
  return { address: ethers.getAddress(address), key, maxFee };
}

// No keys or authorization signatures are returned to the browser.
export async function gasSponsorStatus(provider: ethers.Provider) {
  if (!sponsorshipEnabled()) return { enabled: false, address: null, eth: null, error: null };
  let address: string | null = null;
  try {
    const settings = config(); address = settings.address;
    if (new ethers.Wallet(settings.key).address !== address) throw new Error("Central gas wallet key does not match its address.");
    const eth = await provider.getBalance(address, "pending");
    return { enabled: true, address, eth: ethers.formatEther(eth), error: eth === BigInt(0) ? "Fund this central wallet with ETH on Base before sweeping USDC." : null };
  } catch {
    return { enabled: true, address, eth: null, error: "Central gas wallet configuration or balance is unavailable. Check settings and refresh." };
  }
}

// Prepare only: the caller MUST persist hash before broadcasting rawTransaction.
// No native ETH is sent to a customer. Only the gas wallet pays transaction fees.
export async function prepareSponsoredUsdcSweep(input: {
  provider: ethers.Provider; owner: ethers.Wallet; source: string;
  destination: string; amount: bigint; assertActive: () => Promise<void>;
}) {
  const { provider, owner, amount, assertActive } = input;
  if (!sponsorshipEnabled()) throw new Error("USDC gas sponsorship is disabled.");
  const settings = config();
  const source = ethers.getAddress(input.source), destination = ethers.getAddress(input.destination);
  if (amount <= BigInt(0) || source === destination || destination === ethers.ZeroAddress || destination === SPONSORED_USDC) throw new Error("Invalid USDC sweep.");
  if (owner.address.toLowerCase() !== source.toLowerCase()) throw new Error("Deposit signer mismatch.");
  if (process.env.TREASURY_WALLET_ADDRESS?.toLowerCase() !== destination.toLowerCase()) throw new Error("Treasury destination changed.");
  if (process.env.USDC_CONTRACT_ADDRESS && process.env.USDC_CONTRACT_ADDRESS.toLowerCase() !== SPONSORED_USDC.toLowerCase()) throw new Error("Sponsored sweeps require native USDC on Base.");
  if ((await provider.getNetwork()).chainId !== BigInt(CHAIN_ID)) throw new Error("Sponsored sweeps require Base mainnet.");
  const sponsor = new ethers.Wallet(settings.key);
  if (sponsor.address !== settings.address || sponsor.address.toLowerCase() === source.toLowerCase()) throw new Error("Invalid central gas wallet signer.");
  const [latest, pending, balance, fees, block] = await Promise.all([
    provider.getTransactionCount(sponsor.address, "latest"), provider.getTransactionCount(sponsor.address, "pending"),
    provider.getBalance(sponsor.address, "pending"), provider.getFeeData(), provider.getBlock("latest"),
  ]);
  if (latest !== pending) throw new Error("Central gas wallet has a pending transaction. Wait before retrying.");
  if (!block || !fees.maxFeePerGas || fees.maxPriorityFeePerGas === null) throw new Error("Gas estimate unavailable.");
  const domain = { name: "USD Coin", version: "2", chainId: CHAIN_ID, verifyingContract: SPONSORED_USDC };
  const token = new ethers.Contract(SPONSORED_USDC, abi, provider);
  if (await token.DOMAIN_SEPARATOR() !== ethers.TypedDataEncoder.hashDomain(domain)) throw new Error("USDC authorization domain mismatch.");
  const authorization = { from: source, to: destination, value: amount,
    validAfter: 0, validBefore: block.timestamp + 600, nonce: ethers.hexlify(ethers.randomBytes(32)) };
  await assertActive();
  const signature = ethers.Signature.from(await owner.signTypedData(domain, types, authorization));
  const data = token.interface.encodeFunctionData("transferWithAuthorization", [
    source, destination, amount, authorization.validAfter, authorization.validBefore, authorization.nonce,
    signature.v, signature.r, signature.s,
  ]);
  const call = { from: sponsor.address, to: SPONSORED_USDC, value: BigInt(0), data };
  // Simulate the real authorization before spending gas; fail closed on RPC errors.
  const estimated = await provider.estimateGas(call);
  const gasLimit = (estimated * BigInt(120) + BigInt(99)) / BigInt(100);
  const transaction = { to: SPONSORED_USDC, value: BigInt(0), data, gasLimit,
    nonce: pending, chainId: CHAIN_ID, type: 2,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  // Add 128 bytes for the signature/encoding overhead to the unsigned envelope.
  const size = ethers.getBytes(ethers.Transaction.from(transaction).unsignedSerialized).length + 128;
  const oracle = new ethers.Contract(ORACLE, ["function getL1FeeUpperBound(uint256) view returns (uint256)"], provider);
  const l1Fee: bigint = await oracle.getL1FeeUpperBound(size);
  const budget = gasLimit * fees.maxFeePerGas + l1Fee * BigInt(2);
  if (budget > settings.maxFee) throw new Error("Sweep fee exceeds the central wallet per-transfer limit.");
  if (balance < budget) throw new Error("Central gas wallet needs more ETH on Base.");
  await assertActive();
  const rawTransaction = await sponsor.signTransaction(transaction);
  return { rawTransaction, hash: ethers.keccak256(rawTransaction) };
}
