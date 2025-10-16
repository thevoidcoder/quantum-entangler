// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

interface IUniswapV2Router02 {
    function factory() external view returns (address);

    function WETH() external view returns (address);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

/**
 * @title QuantumQubit
 * @notice QBIT token with buy/sell taxation, automatic liquidity provisioning and
 *         dedicated allocations for the Quantum Entangler ecosystem.
 */
contract QuantumQubit is ERC20, Ownable {
    uint256 private constant FEE_DENOMINATOR = 10_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IUniswapV2Router02 public immutable router;
    address public immutable pair;

    address public entangler;
    address public devWallet;
    address public superpositionVault;

    mapping(address => bool) public isExcludedFromFees;
    mapping(address => bool) public automatedMarketMakerPairs;

    bool public swapEnabled = true;
    bool private swapping;

    uint256 public swapTokensAtAmount = 50_000 * 1e18;

    // Fee configuration (in basis points)
    uint256 public buyFee = 800; // 8%
    uint256 public sellFee = 800; // 8%

    // Allocation of collected fees (must sum to buy/sell fee respectively)
    uint256 public liquidityShare = 200; // 2%
    uint256 public entanglerShare = 300; // 3%
    uint256 public devShare = 200; // 2%
    uint256 public burnShare = 100; // 1%

    uint256 private tokensForLiquidity;
    uint256 private tokensForEntangler;
    uint256 private tokensForDev;

    event FeesUpdated(uint256 buyFee, uint256 sellFee);
    event FeeAllocationUpdated(uint256 liquidityShare, uint256 entanglerShare, uint256 devShare, uint256 burnShare);
    event SwapSettingsUpdated(bool enabled, uint256 threshold);
    event EntanglerUpdated(address indexed entangler);
    event DevWalletUpdated(address indexed devWallet);
    event SuperpositionVaultUpdated(address indexed vault);
    event AutomatedMarketMakerPairSet(address indexed pair, bool value);

    error InvalidAddress();

    constructor(address routerAddress, address devWallet_, address superpositionVault_)
        ERC20("Quantum Qubit", "QBIT")
        Ownable(msg.sender)
    {
        if (routerAddress == address(0) || devWallet_ == address(0) || superpositionVault_ == address(0)) {
            revert InvalidAddress();
        }

        router = IUniswapV2Router02(routerAddress);
        address _pair = IUniswapV2Factory(router.factory()).createPair(address(this), router.WETH());
        pair = _pair;
        automatedMarketMakerPairs[_pair] = true;

        devWallet = devWallet_;
        superpositionVault = superpositionVault_;

        isExcludedFromFees[msg.sender] = true;
        isExcludedFromFees[address(this)] = true;
        isExcludedFromFees[superpositionVault_] = true;

        _mint(msg.sender, 500_000_000 * 1e18);
    }

    function setEntangler(address entangler_) external onlyOwner {
        if (entangler_ == address(0)) revert InvalidAddress();
        entangler = entangler_;
        isExcludedFromFees[entangler_] = true;
        emit EntanglerUpdated(entangler_);
    }

    function setDevWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert InvalidAddress();
        devWallet = wallet;
        emit DevWalletUpdated(wallet);
    }

    function setSuperpositionVault(address vault) external onlyOwner {
        if (vault == address(0)) revert InvalidAddress();
        superpositionVault = vault;
        emit SuperpositionVaultUpdated(vault);
    }

    function setSwapEnabled(bool enabled, uint256 threshold) external onlyOwner {
        swapEnabled = enabled;
        if (threshold > 0) {
            swapTokensAtAmount = threshold;
        }
        emit SwapSettingsUpdated(enabled, swapTokensAtAmount);
    }

    function setAutomatedMarketMakerPair(address account, bool value) external onlyOwner {
        automatedMarketMakerPairs[account] = value;
        emit AutomatedMarketMakerPairSet(account, value);
    }

    function setFees(uint256 newBuyFee, uint256 newSellFee) external onlyOwner {
        uint256 totalShares = liquidityShare + entanglerShare + devShare + burnShare;
        require(newBuyFee == totalShares && newSellFee == totalShares, "Totals mismatch");
        buyFee = newBuyFee;
        sellFee = newSellFee;
        emit FeesUpdated(newBuyFee, newSellFee);
    }

    function setFeeAllocation(uint256 liquidity, uint256 entangler_, uint256 dev, uint256 burn) external onlyOwner {
        require(liquidity + entangler_ + dev + burn == buyFee, "Invalid allocation");
        require(liquidity + entangler_ + dev + burn == sellFee, "Sell fee mismatch");
        liquidityShare = liquidity;
        entanglerShare = entangler_;
        devShare = dev;
        burnShare = burn;
        emit FeeAllocationUpdated(liquidity, entangler_, dev, burn);
    }

    function excludeFromFees(address account, bool excluded) external onlyOwner {
        isExcludedFromFees[account] = excluded;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner() || msg.sender == entangler, "Not authorized");
        _mint(to, amount);
    }

    function burnFromEntangler(uint256 amount) external {
        require(msg.sender == entangler, "Not entangler");
        _burn(entangler, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, amount);
            return;
        }

        if (amount == 0) {
            super._update(from, to, 0);
            return;
        }

        bool takeFee = !swapping;

        if (isExcludedFromFees[from] || isExcludedFromFees[to]) {
            takeFee = false;
        }

        uint256 transferAmount = amount;

        if (takeFee) {
            uint256 totalFee = _getTotalFee(from, to);
            if (totalFee > 0) {
                uint256 feeAmount = (amount * totalFee) / FEE_DENOMINATOR;
                uint256 burnAmount = (amount * burnShare) / FEE_DENOMINATOR;

                transferAmount = amount - feeAmount;

                if (burnAmount > 0) {
                    super._update(from, DEAD, burnAmount);
                }

                uint256 contractPortion = feeAmount - burnAmount;
                if (contractPortion > 0) {
                    super._update(from, address(this), contractPortion);

                    uint256 allocationTotal = totalFee - burnShare;
                    if (allocationTotal > 0) {
                        uint256 liquidityTokensShare = (contractPortion * liquidityShare) / allocationTotal;
                        uint256 entanglerTokensShare = (contractPortion * entanglerShare) / allocationTotal;
                        uint256 devTokensShare = contractPortion - liquidityTokensShare - entanglerTokensShare;

                        tokensForLiquidity += liquidityTokensShare;
                        tokensForEntangler += entanglerTokensShare;
                        tokensForDev += devTokensShare;
                    }
                }
            }
        }

        super._update(from, to, transferAmount);

        uint256 contractBalance = balanceOf(address(this));
        bool canSwap = contractBalance >= swapTokensAtAmount;

        if (canSwap && swapEnabled && !swapping && !automatedMarketMakerPairs[from]) {
            swapping = true;
            _swapBack(contractBalance);
            swapping = false;
        }
    }

    function _getTotalFee(address from, address to) private view returns (uint256) {
        if (automatedMarketMakerPairs[from]) {
            return buyFee;
        }
        if (automatedMarketMakerPairs[to]) {
            return sellFee;
        }
        return 0;
    }

    function _swapBack(uint256 contractBalance) private {
        uint256 totalTokens = tokensForLiquidity + tokensForEntangler + tokensForDev;
        if (totalTokens == 0) {
            return;
        }

        uint256 liquidityTokensTotal = tokensForLiquidity;
        uint256 liquidityTokensHalf = liquidityTokensTotal / 2;
        uint256 amountToSwapForETH = contractBalance - liquidityTokensHalf;

        uint256 initialETHBalance = address(this).balance;
        _swapTokensForETH(amountToSwapForETH);
        uint256 ethBalance = address(this).balance - initialETHBalance;

        uint256 tokensForLiquidityToSwap = liquidityTokensTotal - liquidityTokensHalf;
        uint256 totalShare = tokensForLiquidityToSwap + tokensForEntangler + tokensForDev;
        if (totalShare == 0) {
            return;
        }

        uint256 ethForLiquidity = (ethBalance * tokensForLiquidityToSwap) / totalShare;
        uint256 ethForEntangler = (ethBalance * tokensForEntangler) / totalShare;
        uint256 ethForDev = ethBalance - ethForLiquidity - ethForEntangler;

        tokensForLiquidity = 0;
        tokensForEntangler = 0;
        tokensForDev = 0;

        if (liquidityTokensHalf > 0 && ethForLiquidity > 0) {
            _addLiquidity(liquidityTokensHalf, ethForLiquidity);
        }

        if (ethForEntangler > 0 && entangler != address(0)) {
            payable(entangler).transfer(ethForEntangler);
        }

        if (ethForDev > 0 && devWallet != address(0)) {
            payable(devWallet).transfer(ethForDev);
        }
    }

    function _swapTokensForETH(uint256 tokenAmount) private {
        if (tokenAmount == 0) {
            return;
        }
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();

        _approve(address(this), address(router), tokenAmount);

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    function _addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        _approve(address(this), address(router), tokenAmount);
        router.addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0,
            0,
            owner(),
            block.timestamp
        );
    }

    receive() external payable {}
}
