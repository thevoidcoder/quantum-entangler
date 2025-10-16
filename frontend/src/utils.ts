export function formatNumber(value: bigint | number, decimals = 4): string {
  const num = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

export function formatEther(value: bigint, decimals = 4): string {
  const formatted = Number(value) / 1e18;
  return formatted.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
}

export const shortenAddress = (address: string | null | undefined) => {
  if (!address) return "-";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
};
