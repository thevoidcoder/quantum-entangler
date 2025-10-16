import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcSigner, parseEther, parseUnits } from "ethers";
import { QuantumEntanglerABI, EntanglerInfo } from "./abi/QuantumEntangler";
import { QuantumQubitABI } from "./abi/QuantumQubit";
import { StatCard } from "./components/StatCard";
import { formatEther, formatNumber, shortenAddress } from "./utils";

declare global {
  interface Window {
    ethereum?: any;
  }
}

const DEFAULT_QBIT_DECIMALS = 18n;

function useContract(address: string, abi: any[], signer: JsonRpcSigner | null) {
  return useMemo(() => {
    if (!address || !signer) return null;
    try {
      return new Contract(address, abi, signer);
    } catch (err) {
      console.error("Failed to instantiate contract", err);
      return null;
    }
  }, [address, abi, signer]);
}

export default function App() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [entanglerAddress, setEntanglerAddress] = useState<string>("");
  const [qbitAddress, setQbitAddress] = useState<string>("");
  const [info, setInfo] = useState<EntanglerInfo | null>(null);
  const [pendingQubits, setPendingQubits] = useState<bigint>(0n);
  const [superpositionReserve, setSuperpositionReserve] = useState<bigint>(0n);
  const [bnbBalance, setBnbBalance] = useState<bigint>(0n);
  const [qbitBalance, setQbitBalance] = useState<bigint>(0n);
  const [qbitAllowance, setQbitAllowance] = useState<bigint>(0n);
  const [qbitDecimals, setQbitDecimals] = useState<bigint>(DEFAULT_QBIT_DECIMALS);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [entangleAmount, setEntangleAmount] = useState<string>("0.5");
  const [tokenAmount, setTokenAmount] = useState<string>("0");
  const [superpositionTokenAmount, setSuperpositionTokenAmount] = useState<string>("0");
  const [burnPortion, setBurnPortion] = useState<boolean>(true);

  const entangler = useContract(entanglerAddress, QuantumEntanglerABI, signer);
  const qbit = useContract(qbitAddress, QuantumQubitABI, signer);

  const resetStatus = useCallback(() => setStatus(null), []);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setStatus("No injected wallet found. Install MetaMask or a compatible wallet.");
      return;
    }
    try {
      const nextProvider = new BrowserProvider(window.ethereum, "any");
      await nextProvider.send("eth_requestAccounts", []);
      const nextSigner = await nextProvider.getSigner();
      setProvider(nextProvider);
      setSigner(nextSigner);
      setAccount(await nextSigner.getAddress());
      setStatus("Connected to wallet.");
    } catch (err: any) {
      console.error(err);
      setStatus(err?.message || "Failed to connect wallet");
    }
  }, []);

  useEffect(() => {
    if (!provider || !account) return;
    const updateBalance = async () => {
      const balance = await provider.getBalance(account);
      setBnbBalance(balance);
    };
    updateBalance();
    const interval = setInterval(updateBalance, 15000);
    return () => clearInterval(interval);
  }, [provider, account]);

  useEffect(() => {
    if (!entangler || !account) {
      setInfo(null);
      setPendingQubits(0n);
      return;
    }
    let cancelled = false;
    const pullData = async () => {
      try {
        const result = await entangler.getUserInfo(account);
        if (cancelled) return;
        const structured: EntanglerInfo = {
          entanglers: result[0],
          claimed: result[1],
          staked: result[2],
          pending: result[3],
          referrer: result[4]
        };
        setInfo(structured);
        setPendingQubits(await entangler.getMyQubits(account));
        setSuperpositionReserve(await entangler.superpositionReserve());
      } catch (err) {
        console.warn("Failed to fetch entangler state", err);
      }
    };
    pullData();
    const interval = setInterval(pullData, 12000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [entangler, account]);

  useEffect(() => {
    if (!qbit || !account) {
      setQbitBalance(0n);
      setQbitAllowance(0n);
      setQbitDecimals(DEFAULT_QBIT_DECIMALS);
      return;
    }
    let cancelled = false;
    const fetchTokenData = async () => {
      try {
        const [balance, allowance, decimals] = await Promise.all([
          qbit.balanceOf(account),
          entanglerAddress ? qbit.allowance(account, entanglerAddress) : Promise.resolve(0n),
          qbit.decimals().catch(() => Number(DEFAULT_QBIT_DECIMALS))
        ]);
        if (cancelled) return;
        setQbitBalance(balance);
        setQbitAllowance(allowance);
        setQbitDecimals(BigInt(decimals));
      } catch (err) {
        console.warn("Failed to read QBIT data", err);
      }
    };
    fetchTokenData();
    const interval = setInterval(fetchTokenData, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [qbit, account, entanglerAddress]);

  const ensureAllowance = useCallback(
    async (amount: bigint) => {
      if (!qbit || !account || !entanglerAddress) return;
      if (qbitAllowance >= amount) return;
      setLoadingAction("Approving QBIT");
      const tx = await qbit.approve(entanglerAddress, amount);
      await tx.wait();
      setStatus("Allowance updated");
      setQbitAllowance(amount);
    },
    [qbit, account, entanglerAddress, qbitAllowance]
  );

  const handleEntangle = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!entangler || !account) return;
      try {
        setLoadingAction("Entangling BNB");
        const value = parseEther(entangleAmount || "0");
        const tx = await entangler.entangle(account, { value });
        await tx.wait();
        setStatus("Entanglement successful.");
      } catch (err: any) {
        console.error(err);
        setStatus(err?.shortMessage || err?.message || "Failed to entangle");
      } finally {
        setLoadingAction(null);
      }
    },
    [entangler, account, entangleAmount]
  );

  const handleCompound = useCallback(async () => {
    if (!entangler) return;
    try {
      setLoadingAction("Compounding");
      const tx = await entangler.compoundQubits();
      await tx.wait();
      setStatus("Qubits compounded.");
    } catch (err: any) {
      setStatus(err?.shortMessage || err?.message || "Compound failed");
    } finally {
      setLoadingAction(null);
    }
  }, [entangler]);

  const handleCollapse = useCallback(async () => {
    if (!entangler) return;
    try {
      setLoadingAction("Collapsing");
      const tx = await entangler.collapseQubits();
      await tx.wait();
      setStatus("Collapse complete. Rewards harvested.");
    } catch (err: any) {
      setStatus(err?.shortMessage || err?.message || "Collapse failed");
    } finally {
      setLoadingAction(null);
    }
  }, [entangler]);

  const handleStake = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!entangler || !qbit || !account) return;
      try {
        const amount = parseUnits(tokenAmount || "0", Number(qbitDecimals));
        await ensureAllowance(amount);
        setLoadingAction("Staking QBIT");
        const tx = await entangler.stakeQbit(amount);
        await tx.wait();
        setStatus("Stake complete.");
      } catch (err: any) {
        setStatus(err?.shortMessage || err?.message || "Stake failed");
      } finally {
        setLoadingAction(null);
      }
    },
    [entangler, qbit, account, tokenAmount, qbitDecimals, ensureAllowance]
  );

  const handleClaimTokens = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!entangler) return;
      try {
        const amount = parseUnits(tokenAmount || "0", Number(qbitDecimals));
        setLoadingAction("Claiming QBIT");
        const tx = await entangler.claimQbitTokens(amount);
        await tx.wait();
        setStatus("Tokens claimed");
      } catch (err: any) {
        setStatus(err?.shortMessage || err?.message || "Claim failed");
      } finally {
        setLoadingAction(null);
      }
    },
    [entangler, tokenAmount, qbitDecimals]
  );

  const handleDisentangle = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!entangler) return;
      try {
        const amount = parseUnits(tokenAmount || "0", Number(qbitDecimals));
        setLoadingAction("Disentangling");
        const tx = await entangler.disentangle(amount);
        await tx.wait();
        setStatus("Disentangled stake");
      } catch (err: any) {
        setStatus(err?.shortMessage || err?.message || "Disentangle failed");
      } finally {
        setLoadingAction(null);
      }
    },
    [entangler, tokenAmount, qbitDecimals]
  );

  const handleProcessSuperposition = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!entangler) return;
      try {
        const amount = parseUnits(superpositionTokenAmount || "0", Number(qbitDecimals));
        setLoadingAction("Processing superposition");
        const tx = await entangler.processSuperposition(amount, burnPortion);
        await tx.wait();
        setStatus("Superposition processed.");
      } catch (err: any) {
        setStatus(err?.shortMessage || err?.message || "Superposition failed");
      } finally {
        setLoadingAction(null);
      }
    },
    [entangler, superpositionTokenAmount, qbitDecimals, burnPortion]
  );

  const disableActions = !entangler || !account || !!loadingAction;

  return (
    <div className="app-shell">
      <header>
        <div className="badge">Quantum Entangler Control</div>
        <h1 style={{ margin: 0 }}>Qubit Mining Dashboard</h1>
        <p style={{ maxWidth: "720px", lineHeight: 1.6, opacity: 0.8 }}>
          Connect your wallet, drop BNB into the entangler, and manage your qubit accrual loop. Configure the contract addresses
          below to point at your deployed instances on BSC or a fork.
        </p>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={connectWallet} disabled={!!account}>
            {account ? `Connected: ${shortenAddress(account)}` : "Connect Wallet"}
          </button>
          <div className="badge">BNB Balance: {formatEther(bnbBalance)} BNB</div>
        </div>
        {status && (
          <div style={{ color: "#38bdf8", fontSize: "0.95rem" }} onClick={resetStatus}>
            {status}
          </div>
        )}
      </header>

      <div className="main-grid">
        <div className="card">
          <h2>Contract Endpoints</h2>
          <form className="actions" style={{ marginTop: "1rem" }}>
            <label>
              Entangler Address
              <input value={entanglerAddress} onChange={(e) => setEntanglerAddress(e.target.value.trim())} placeholder="0x..." />
            </label>
            <label>
              QBIT Token Address
              <input value={qbitAddress} onChange={(e) => setQbitAddress(e.target.value.trim())} placeholder="0x..." />
            </label>
            <small style={{ opacity: 0.65 }}>
              The dashboard reads state live; make sure the addresses match your deployments. The referral field defaults to your own
              address when entangling.
            </small>
          </form>
        </div>

        <StatCard
          title="Your Qubit Web"
          value={`${formatNumber(info?.entanglers ?? 0n)} entanglers`}
          description={
            <>
              <div>Pending qubits: {formatNumber(pendingQubits)}</div>
              <div>Claimed cache: {formatNumber(info?.claimed ?? 0n)}</div>
            </>
          }
        />

        <StatCard
          title="QBIT Inventory"
          value={`${formatEther(qbitBalance)} QBIT`}
          description={
            <>
              <div>Staked in entangler: {formatEther(info?.staked ?? 0n)} QBIT</div>
              <div>Allowance: {formatEther(qbitAllowance)} QBIT</div>
            </>
          }
        />

        <StatCard
          title="Superposition Reserve"
          value={`${formatEther(superpositionReserve)} BNB`}
          description="Community-controlled vault fed by harvest decay and referral overflow."
        />
      </div>

      <div className="main-grid">
        <div className="card actions">
          <h2>Entangle BNB</h2>
          <form onSubmit={handleEntangle} className="actions">
            <label>
              BNB to entangle
              <input type="number" step="0.01" min="0" value={entangleAmount} onChange={(e) => setEntangleAmount(e.target.value)} />
            </label>
            <button type="submit" disabled={disableActions}>
              {loadingAction === "Entangling BNB" ? "Entangling…" : "Entangle"}
            </button>
          </form>
          <button onClick={handleCompound} disabled={disableActions}>
            {loadingAction === "Compounding" ? "Compounding…" : "Compound"}
          </button>
          <button onClick={handleCollapse} disabled={disableActions}>
            {loadingAction === "Collapsing" ? "Collapsing…" : "Collapse & Harvest"}
          </button>
        </div>

        <div className="card actions">
          <h2>Manage QBIT Stake</h2>
          <form onSubmit={handleStake} className="actions">
            <label>
              QBIT amount
              <input type="number" min="0" step="0.0001" value={tokenAmount} onChange={(e) => setTokenAmount(e.target.value)} />
            </label>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button type="submit" disabled={disableActions}>
                {loadingAction === "Staking QBIT" ? "Staking…" : "Stake"}
              </button>
              <button onClick={handleClaimTokens} disabled={disableActions}>
                {loadingAction === "Claiming QBIT" ? "Claiming…" : "Claim"}
              </button>
              <button onClick={handleDisentangle} disabled={disableActions}>
                {loadingAction === "Disentangling" ? "Disentangling…" : "Disentangle"}
              </button>
            </div>
          </form>
        </div>

        <div className="card actions">
          <h2>Superposition Controls</h2>
          <form onSubmit={handleProcessSuperposition} className="actions">
            <label>
              Token amount to route
              <input
                type="number"
                min="0"
                step="0.0001"
                value={superpositionTokenAmount}
                onChange={(e) => setSuperpositionTokenAmount(e.target.value)}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="checkbox" checked={burnPortion} onChange={(e) => setBurnPortion(e.target.checked)} /> Burn 20% before routing
            </label>
            <button type="submit" disabled={disableActions}>
              {loadingAction === "Processing superposition" ? "Processing…" : "Process Vault"}
            </button>
            <small style={{ opacity: 0.65 }}>
              Owner only: routes the accumulated reserve and optional QBIT into the superposition destination wallet.
            </small>
          </form>
        </div>
      </div>

      <footer className="footer-links">
        <span>Need deployed addresses? Run the Hardhat scripts or tests provided in the repo.</span>
        <a href="https://pancakeswap.finance" target="_blank" rel="noreferrer">
          PancakeSwap
        </a>
        <a href="https://docs.ethers.org/v6/" target="_blank" rel="noreferrer">
          ethers.js docs
        </a>
      </footer>
    </div>
  );
}
