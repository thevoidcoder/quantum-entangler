// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

contract MockPancakePair {
    address public immutable token0;
    address public immutable token1;

    constructor(address tokenA, address tokenB) {
        token0 = tokenA;
        token1 = tokenB;
    }
}

contract MockPancakeFactory {
    address public lastPair;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        MockPancakePair newPair = new MockPancakePair(tokenA, tokenB);
        lastPair = address(newPair);
        return address(newPair);
    }
}
