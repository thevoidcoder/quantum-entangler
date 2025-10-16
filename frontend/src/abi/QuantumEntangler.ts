export const QuantumEntanglerABI = [
  "event Entangle(address indexed user, uint256 bnbUsed, uint256 qubitsBought, uint256 newEntanglers)",
  "event Collapse(address indexed user, uint256 qubitsSold, uint256 netPayout, uint256 referralPaid, uint256 superpositionAccrued)",
  "function entangle(address referrer) payable",
  "function compoundQubits()",
  "function collapseQubits()",
  "function stakeQbit(uint256 amount)",
  "function claimQbitTokens(uint256 amount)",
  "function disentangle(uint256 amount)",
  "function processSuperposition(uint256 tokenAmount, bool burnPortion)",
  "function getUserInfo(address account) view returns (uint256 entanglers, uint256 claimed, uint256 staked, uint256 pending, address referrer)",
  "function getMyQubits(address account) view returns (uint256)",
  "function superpositionReserve() view returns (uint256)",
  "function calculateQubitBuySimple(uint256 bnb) view returns (uint256)",
  "function devWallet() view returns (address)",
  "function communityWallet() view returns (address)",
  "function superpositionWallet() view returns (address)"
];

export type EntanglerInfo = {
  entanglers: bigint;
  claimed: bigint;
  staked: bigint;
  pending: bigint;
  referrer: string;
};
