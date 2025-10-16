// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MockPancakeFactory.sol";

contract MockPancakeRouter {
    MockPancakeFactory public immutable factoryContract;
    address public immutable weth;

    event LiquidityAdded(address indexed provider, uint256 tokenAmount, uint256 ethAmount);
    event SwapPerformed(uint256 amountIn, address indexed to);

    constructor(address weth_) {
        weth = weth_;
        factoryContract = new MockPancakeFactory();
    }

    function WETH() external view returns (address) {
        return weth;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256,
        uint256,
        address to,
        uint256
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        IERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        emit LiquidityAdded(to, amountTokenDesired, msg.value);
        return (amountTokenDesired, msg.value, 0);
    }

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256,
        address[] calldata path,
        address to,
        uint256
    ) external {
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        emit SwapPerformed(amountIn, to);
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "ETH send failed");
    }

    function factory() external view returns (address) {
        return address(factoryContract);
    }

    receive() external payable {}
}
