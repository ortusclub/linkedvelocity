import { ethers } from "ethers";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

let _provider: ethers.JsonRpcProvider | null = null;

export function getBaseProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    const request = new ethers.FetchRequest(process.env.BASE_RPC_URL || "https://mainnet.base.org");
    request.timeout = 5_000;
    request.setThrottleParams({ maxAttempts: 1 });
    _provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1 });
  }
  return _provider;
}

export function getUsdcContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  const address = process.env.USDC_CONTRACT_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  return new ethers.Contract(address, USDC_ABI, signerOrProvider || getBaseProvider());
}

// Bridged USDT on Base, with 6 decimals. Sweeping does not credit app balances.
export function getUsdtContract(signerOrProvider?: ethers.Signer | ethers.Provider): ethers.Contract {
  return new ethers.Contract(
    "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    USDC_ABI,
    signerOrProvider || getBaseProvider(),
  );
}

export function getDepositAddress(derivationIndex: number): { address: string; privateKey: string } {
  const mnemonic = process.env.HD_WALLET_SEED_PHRASE;
  if (!mnemonic) throw new Error("HD_WALLET_SEED_PHRASE not configured");

  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0");
  const child = hdNode.deriveChild(derivationIndex);
  return { address: child.address, privateKey: child.privateKey };
}

export function getChildWallet(derivationIndex: number): ethers.Wallet {
  const { privateKey } = getDepositAddress(derivationIndex);
  return new ethers.Wallet(privateKey, getBaseProvider());
}


export function getTreasuryAddress(): string {
  return process.env.TREASURY_WALLET_ADDRESS || "0x953f06a4229e451f0Bc5E589a763EE5A9058882D";
}

export function getTreasuryWallet(): ethers.Wallet {
  const privateKey = process.env.TREASURY_PRIVATE_KEY;
  if (!privateKey) throw new Error("TREASURY_PRIVATE_KEY not configured");
  return new ethers.Wallet(privateKey, getBaseProvider());
}

// USDC on Base has 6 decimals
export function parseUsdc(amount: string | number): bigint {
  return ethers.parseUnits(String(amount), 6);
}

export function formatUsdc(amount: bigint): string {
  return ethers.formatUnits(amount, 6);
}
