// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./QBIT.sol";

/**
 * @title QuantumEntangler
 * @notice Ponzi-style BNB miner with an ERC-20 wrapper and multi-level referral web.
 */
contract QuantumEntangler is Ownable, ReentrancyGuard {
    using SafeERC20 for QuantumQubit;

    uint256 private constant QUBITS_TO_HATCH_1_ENTANGLER = 86_400;
    uint256 private constant PSN = 10_000;
    uint256 private constant PSNH = 5_000;
    uint256 private constant BPS = 10_000;

    uint256 private constant REFERRAL_BONUS_BPS = 1_000; // 10% first entangle bonus
    uint256 private constant HARVEST_REFERRAL_BPS = 500; // 5% per level
    uint256 private constant HARVEST_LEVELS = 3;
    uint256 private constant DEV_FEE_BPS = 200; // 2%
    uint256 private constant COMMUNITY_FEE_BPS = 300; // 3%
    uint256 private constant DECAY_PENALTY_BPS = 300; // 3%
    uint256 private constant SUPERPOSITION_BURN_BPS = 2_000; // 20%
    uint256 private constant TIME_BONUS_THRESHOLD = 7 days; // Bonus threshold
    uint256 private constant TIME_BONUS_BPS = 1_000; // 10% bonus for holding > 7 days
    uint256 private constant COMPOUND_BONUS_BPS = 500; // 5% bonus on compound
    uint256 private constant BUYBACK_BPS = 5_000; // 50% of entangler taxes used for buyback

    QuantumQubit public immutable qbit;

    struct UserInfo {
        uint256 entanglers;
        uint256 claimedQubits;
        uint256 lastAction;
        uint256 stakedQbit;
        address referrer;
        bool referralBoostClaimed;
        uint256 totalCompounds;
        uint256 firstEntangleTime;
    }

    mapping(address => UserInfo) private users;

    uint256 public totalEntanglers;
    uint256 public totalStakedQbit;
    uint256 public marketQubits;
    uint256 public superpositionReserve; // BNB earmarked for the superposition pool
    uint256 public treasuryReserve; // BNB for buybacks and price support
    uint256 public totalBuybacks;
    uint256 public totalCompounds;

    address public devWallet;
    address public communityWallet;
    address public superpositionWallet;

    event Entangle(address indexed user, uint256 bnbUsed, uint256 qubitsBought, uint256 newEntanglers);
    event Compound(address indexed user, uint256 qubitsUsed, uint256 newEntanglers, uint256 bonusApplied);
    event Collapse(address indexed user, uint256 qubitsSold, uint256 netPayout, uint256 referralPaid, uint256 superpositionAccrued);
    event Disentangle(address indexed user, uint256 qbitAmount, uint256 payout, uint256 penalty);
    event Stake(address indexed user, uint256 amount);
    event ClaimTokens(address indexed user, uint256 amount);
    event BreakEntanglement(address indexed user);
    event SuperpositionProcessed(uint256 bnbSent, uint256 tokensBurned);
    event BuybackExecuted(uint256 bnbSpent, uint256 tokensBought);
    event TimeBonusAwarded(address indexed user, uint256 bonusAmount);

    error ZeroAddress();
    error NothingToProcess();

    constructor(QuantumQubit token, address dev, address community, address superposition) Ownable(msg.sender) {
        if (address(token) == address(0) || dev == address(0) || community == address(0) || superposition == address(0)) {
            revert ZeroAddress();
        }
        qbit = token;
        devWallet = dev;
        communityWallet = community;
        superpositionWallet = superposition;
        marketQubits = QUBITS_TO_HATCH_1_ENTANGLER * 100_000;
    }

    // ------------------ External gameplay ------------------

    function entangle(address referrer) external payable nonReentrant {
        require(msg.value > 0, "No BNB sent");
        _linkReferrer(msg.sender, referrer);

        uint256 devFee = (msg.value * DEV_FEE_BPS) / BPS;
        uint256 communityFee = (msg.value * COMMUNITY_FEE_BPS) / BPS;

        if (devFee > 0) {
            payable(devWallet).transfer(devFee);
        }
        if (communityFee > 0) {
            payable(communityWallet).transfer(communityFee);
        }

        uint256 amount = msg.value - devFee - communityFee;
        require(amount > 0, "Net amount zero");

        uint256 contractBalanceBefore = address(this).balance - amount;
        uint256 qubitsBought = calculateQubitBuy(amount, contractBalanceBefore);

        UserInfo storage user = users[msg.sender];
        
        // Set first entangle time for time-based bonuses
        if (user.firstEntangleTime == 0) {
            user.firstEntangleTime = block.timestamp;
        }
        
        user.claimedQubits += qubitsBought;

        if (!user.referralBoostClaimed && user.referrer != address(0)) {
            uint256 bonus = (qubitsBought * REFERRAL_BONUS_BPS) / BPS;
            if (bonus > 0) {
                user.claimedQubits += bonus;
            }
            user.referralBoostClaimed = true;
        }

        uint256 newEntanglers = _compound(msg.sender);
        uint256 mintedTokens = newEntanglers * 1e18;
        if (mintedTokens > 0) {
            qbit.mint(address(this), mintedTokens);
            user.stakedQbit += mintedTokens;
            totalStakedQbit += mintedTokens;
        }

        emit Entangle(msg.sender, amount, qubitsBought, newEntanglers);
    }

    function compoundQubits() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        uint256 qubits = getMyQubits(msg.sender);
        
        // Apply compound bonus
        uint256 compoundBonus = (qubits * COMPOUND_BONUS_BPS) / BPS;
        if (compoundBonus > 0) {
            user.claimedQubits += compoundBonus;
            qubits += compoundBonus;
        }
        
        // Apply time-based bonus for long-term holders
        if (user.firstEntangleTime > 0 && block.timestamp - user.firstEntangleTime >= TIME_BONUS_THRESHOLD) {
            uint256 timeBonus = (qubits * TIME_BONUS_BPS) / BPS;
            if (timeBonus > 0) {
                user.claimedQubits += timeBonus;
                emit TimeBonusAwarded(msg.sender, timeBonus);
            }
        }
        
        uint256 newEntanglers = _compound(msg.sender);
        user.totalCompounds++;
        totalCompounds++;
        
        uint256 mintedTokens = newEntanglers * 1e18;
        if (mintedTokens > 0) {
            qbit.mint(address(this), mintedTokens);
            user.stakedQbit += mintedTokens;
            totalStakedQbit += mintedTokens;
        }
        
        emit Compound(msg.sender, qubits, newEntanglers, compoundBonus);
    }

    function collapseQubits() external nonReentrant {
        UserInfo storage user = users[msg.sender];
        uint256 qubitsAvailable = getMyQubits(msg.sender);
        require(qubitsAvailable > 0, "Nothing to collapse");

        uint256 qubitValue = calculateQubitSell(qubitsAvailable);
        require(qubitValue > 0, "No liquidity");

        user.claimedQubits = 0;
        user.lastAction = block.timestamp;
        marketQubits += qubitsAvailable / 5;

        uint256 devFee = (qubitValue * DEV_FEE_BPS) / BPS;
        uint256 communityFee = (qubitValue * COMMUNITY_FEE_BPS) / BPS;
        uint256 payoutPool = qubitValue - devFee - communityFee;

        uint256 referralPool = (payoutPool * HARVEST_REFERRAL_BPS * HARVEST_LEVELS) / BPS;
        uint256 referralPaid = _distributeHarvestReferral(msg.sender, referralPool);
        uint256 superpositionCut = referralPool - referralPaid;
        if (superpositionCut > 0) {
            superpositionReserve += superpositionCut;
        }

        uint256 netPayout = payoutPool - referralPool;

        if (devFee > 0) {
            payable(devWallet).transfer(devFee);
        }
        if (communityFee > 0) {
            payable(communityWallet).transfer(communityFee);
        }
        if (netPayout > 0) {
            payable(msg.sender).transfer(netPayout);
        }

        emit Collapse(msg.sender, qubitsAvailable, netPayout, referralPaid, superpositionCut);
    }

    function stakeQbit(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        qbit.safeTransferFrom(msg.sender, address(this), amount);
        UserInfo storage user = users[msg.sender];
        user.stakedQbit += amount;
        totalStakedQbit += amount;
        if (user.lastAction == 0) {
            user.lastAction = block.timestamp;
        }
        emit Stake(msg.sender, amount);
    }

    function claimQbitTokens(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        UserInfo storage user = users[msg.sender];
        require(user.stakedQbit >= amount, "Too much");
        user.stakedQbit -= amount;
        totalStakedQbit -= amount;
        qbit.safeTransfer(msg.sender, amount);
        emit ClaimTokens(msg.sender, amount);
    }

    function disentangle(uint256 amount) external nonReentrant {
        require(amount > 0, "Zero amount");
        UserInfo storage user = users[msg.sender];
        require(user.stakedQbit >= amount, "Too much");

        user.stakedQbit -= amount;
        totalStakedQbit -= amount;
        qbit.burnFromEntangler(amount);

        // Convert QBIT token amount (1e18 per entangler) to qubits (86400 per entangler)
        uint256 qubits = (amount * QUBITS_TO_HATCH_1_ENTANGLER) / 1e18;
        uint256 bnbValue = calculateQubitSell(qubits);
        uint256 penalty;
        if (getQubitsSinceLastAction(msg.sender) > 0) {
            penalty = (bnbValue * DECAY_PENALTY_BPS) / BPS;
            superpositionReserve += penalty;
        }

        uint256 payout = bnbValue - penalty;
        if (payout > 0) {
            payable(msg.sender).transfer(payout);
        }

        marketQubits += qubits / 5;

        emit Disentangle(msg.sender, amount, payout, penalty);
    }

    function breakEntanglement() external {
        users[msg.sender].referrer = address(0);
        emit BreakEntanglement(msg.sender);
    }

    // ------------------ Administrative ------------------

    function setDevWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        devWallet = wallet;
    }

    function setCommunityWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        communityWallet = wallet;
    }

    function setSuperpositionWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        superpositionWallet = wallet;
    }

    function processSuperposition(uint256 tokenAmount, bool burnPortion) external onlyOwner nonReentrant {
        uint256 reserve = superpositionReserve;
        if (reserve == 0 && tokenAmount == 0) revert NothingToProcess();
        superpositionReserve = 0;

        uint256 burned;
        if (burnPortion && tokenAmount > 0) {
            burned = (tokenAmount * SUPERPOSITION_BURN_BPS) / BPS;
            if (burned > 0) {
                qbit.burnFromEntangler(burned);
            }
            tokenAmount -= burned;
        }

        if (tokenAmount > 0) {
            qbit.safeTransfer(superpositionWallet, tokenAmount);
        }

        if (reserve > 0) {
            payable(superpositionWallet).transfer(reserve);
        }

        emit SuperpositionProcessed(reserve, burned);
    }

    function seedMarket() external payable onlyOwner {
        require(marketQubits == 0 || msg.value > 0, "Seed once");
        if (marketQubits == 0) {
            marketQubits = QUBITS_TO_HATCH_1_ENTANGLER * 100_000;
        }
    }

    /**
     * @notice Execute buyback using treasury reserve
     * @param bnbAmount Amount of BNB to spend on buyback
     */
    function executeBuyback(uint256 bnbAmount) external onlyOwner nonReentrant {
        require(bnbAmount > 0 && bnbAmount <= treasuryReserve, "Invalid amount");
        treasuryReserve -= bnbAmount;
        
        // Buy QBIT tokens from the market using PancakeSwap
        address[] memory path = new address[](2);
        path[0] = qbit.router().WETH();
        path[1] = address(qbit);
        
        uint256 balanceBefore = qbit.balanceOf(address(this));
        
        qbit.router().swapExactETHForTokensSupportingFeeOnTransferTokens{value: bnbAmount}(
            0, // accept any amount of tokens
            path,
            address(this),
            block.timestamp
        );
        
        uint256 tokensReceived = qbit.balanceOf(address(this)) - balanceBefore;
        totalBuybacks += tokensReceived;
        
        // Burn 50% of bought tokens to create deflationary pressure
        if (tokensReceived > 0) {
            uint256 burnAmount = tokensReceived / 2;
            if (burnAmount > 0) {
                qbit.burnFromEntangler(burnAmount);
            }
        }
        
        emit BuybackExecuted(bnbAmount, tokensReceived);
    }

    // ------------------ Views ------------------

    function getUserInfo(address account)
        external
        view
        returns (
            uint256 entanglers,
            uint256 claimed,
            uint256 staked,
            uint256 pending,
            address referrer
        )
    {
        UserInfo storage user = users[account];
        entanglers = user.entanglers;
        claimed = user.claimedQubits;
        staked = user.stakedQbit;
        pending = getMyQubits(account);
        referrer = user.referrer;
    }

    function getMyQubits(address account) public view returns (uint256) {
        UserInfo storage user = users[account];
        return user.claimedQubits + getQubitsSinceLastAction(account);
    }

    function getQubitsSinceLastAction(address account) public view returns (uint256) {
        UserInfo storage user = users[account];
        if (user.lastAction == 0) {
            return 0;
        }
        uint256 secondsPassed = block.timestamp - user.lastAction;
        if (secondsPassed > QUBITS_TO_HATCH_1_ENTANGLER) {
            secondsPassed = QUBITS_TO_HATCH_1_ENTANGLER;
        }
        return secondsPassed * user.entanglers;
    }

    function calculateQubitSell(uint256 qubits) public view returns (uint256) {
        if (qubits == 0) {
            return 0;
        }
        return _calculateTrade(qubits, marketQubits, address(this).balance);
    }

    function calculateQubitBuy(uint256 bnb, uint256 contractBalance) public view returns (uint256) {
        return _calculateTrade(bnb, contractBalance, marketQubits);
    }

    function calculateQubitBuySimple(uint256 bnb) external view returns (uint256) {
        return calculateQubitBuy(bnb, address(this).balance);
    }

    function getReferrer(address account) external view returns (address) {
        return users[account].referrer;
    }

    // ------------------ Internal helpers ------------------

    function _compound(address userAddr) internal returns (uint256 newEntanglers) {
        UserInfo storage user = users[userAddr];
        uint256 qubits = getMyQubits(userAddr);
        if (qubits < QUBITS_TO_HATCH_1_ENTANGLER) {
            user.claimedQubits = qubits;
            user.lastAction = block.timestamp;
            return 0;
        }

        newEntanglers = qubits / QUBITS_TO_HATCH_1_ENTANGLER;
        uint256 qubitsUsed = newEntanglers * QUBITS_TO_HATCH_1_ENTANGLER;

        user.entanglers += newEntanglers;
        user.claimedQubits = qubits - qubitsUsed;
        user.lastAction = block.timestamp;

        totalEntanglers += newEntanglers;
        marketQubits += qubitsUsed / 5;

        emit Compound(userAddr, qubitsUsed, newEntanglers, 0);
    }

    function _linkReferrer(address userAddr, address referrer) internal {
        if (referrer == address(0) || referrer == userAddr) {
            return;
        }
        UserInfo storage user = users[userAddr];
        if (user.referrer == address(0)) {
            user.referrer = referrer;
        }
    }

    function _distributeHarvestReferral(address userAddr, uint256 referralPool) internal returns (uint256 paid) {
        if (referralPool == 0) {
            return 0;
        }
        uint256 perLevel = referralPool / HARVEST_LEVELS;
        uint256 distributed;
        address current = users[userAddr].referrer;
        for (uint256 i = 0; i < HARVEST_LEVELS && current != address(0); i++) {
            uint256 share = perLevel;
            if (i == HARVEST_LEVELS - 1) {
                share = referralPool - distributed;
            }
            if (share > 0) {
                payable(current).transfer(share);
                distributed += share;
            }
            current = users[current].referrer;
        }
        return distributed;
    }

    function _calculateTrade(uint256 rt, uint256 rs, uint256 bs) private pure returns (uint256) {
        if (rt == 0) {
            return 0;
        }
        return (PSN * bs) / (PSNH + ((PSN * rs + PSNH * rt) / rt));
    }

    /**
     * @notice Receive BNB from QBIT token contract (entangler share of taxes)
     * Routes a portion to treasury for buybacks
     */
    receive() external payable {
        // When receiving BNB from QBIT contract, allocate portion to treasury for buybacks
        if (msg.sender == address(qbit) && msg.value > 0) {
            uint256 buybackAmount = (msg.value * BUYBACK_BPS) / BPS;
            if (buybackAmount > 0) {
                treasuryReserve += buybackAmount;
            }
        }
    }
}
