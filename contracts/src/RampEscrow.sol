// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  RampEscrow
 * @notice Escrow contract for Luma Ramp on/off-ramp operations.
 *
 * Flow (off-ramp: Crypto → FCFA):
 *   1. User calls deposit() — tokens locked in this contract.
 *   2. Platform processes FCFA mobile-money payment off-chain.
 *   3. Platform calls completeTransaction() — tokens sent to platformWallet.
 *   4. OR: Platform calls cancelTransaction() — tokens returned to user.
 *   5. OR: User calls claimExpired() after EXPIRY_DELAY — trustless refund.
 *
 * @dev Uses SafeERC20 to handle non-standard ERC-20 tokens (USDT on Ethereum).
 */
contract RampEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────
    uint256 public constant EXPIRY_DELAY = 24 hours;  // user can refund after this

    // ─── State ────────────────────────────────────────────────────────────────
    address public platformWallet;

    struct Transaction {
        address user;
        uint256 amount;
        address token;
        uint256 createdAt;
        bool    isCompleted;
        bool    isCancelled;
    }

    mapping(bytes32 => Transaction) public transactions;

    // Allowed stablecoins (set at construction, updatable by owner)
    mapping(address => bool) public allowedTokens;

    // ─── Events ───────────────────────────────────────────────────────────────
    event TokenAllowed(address indexed token, bool allowed);
    event PlatformWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event Deposited(bytes32 indexed txId, address indexed user, uint256 amount, address token);
    event Completed(bytes32 indexed txId, address indexed platformWallet, uint256 amount);
    event Cancelled(bytes32 indexed txId, address indexed user, uint256 amount);
    event ExpiredClaimed(bytes32 indexed txId, address indexed user, uint256 amount);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _platformWallet, address[] memory _allowedTokens) Ownable(msg.sender) {
        require(_platformWallet != address(0), "Invalid platform wallet");
        platformWallet = _platformWallet;
        for (uint i = 0; i < _allowedTokens.length; i++) {
            allowedTokens[_allowedTokens[i]] = true;
            emit TokenAllowed(_allowedTokens[i], true);
        }
    }

    // ─── Owner config ─────────────────────────────────────────────────────────
    function setPlatformWallet(address _newWallet) external onlyOwner {
        require(_newWallet != address(0), "Invalid address");
        emit PlatformWalletUpdated(platformWallet, _newWallet);
        platformWallet = _newWallet;
    }

    function setTokenAllowed(address _token, bool _allowed) external onlyOwner {
        allowedTokens[_token] = _allowed;
        emit TokenAllowed(_token, _allowed);
    }

    // ─── Core functions ───────────────────────────────────────────────────────

    /**
     * @notice User locks tokens into escrow to initiate an off-ramp.
     * @param txId   SHA-256 of the Luma Ramp transaction reference.
     * @param amount Token amount (in token's native decimals).
     * @param token  ERC-20 token address (must be in allowedTokens).
     */
    function deposit(bytes32 txId, uint256 amount, address token) external nonReentrant {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Amount must be > 0");
        require(transactions[txId].user == address(0), "Transaction already exists");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        transactions[txId] = Transaction({
            user:        msg.sender,
            amount:      amount,
            token:       token,
            createdAt:   block.timestamp,
            isCompleted: false,
            isCancelled: false
        });

        emit Deposited(txId, msg.sender, amount, token);
    }

    /**
     * @notice Platform confirms FCFA was sent — releases tokens to platformWallet.
     */
    function completeTransaction(bytes32 txId) external onlyOwner nonReentrant {
        Transaction storage txData = _getActive(txId);
        txData.isCompleted = true;

        IERC20(txData.token).safeTransfer(platformWallet, txData.amount);

        emit Completed(txId, platformWallet, txData.amount);
    }

    /**
     * @notice Platform cancels — returns tokens to user (e.g. Mobile Money failed).
     */
    function cancelTransaction(bytes32 txId) external onlyOwner nonReentrant {
        Transaction storage txData = _getActive(txId);
        txData.isCancelled = true;

        IERC20(txData.token).safeTransfer(txData.user, txData.amount);

        emit Cancelled(txId, txData.user, txData.amount);
    }

    /**
     * @notice Trustless refund — user can claim back tokens after EXPIRY_DELAY
     *         without needing platform action. Prevents funds from being locked forever.
     */
    function claimExpired(bytes32 txId) external nonReentrant {
        Transaction storage txData = transactions[txId];
        require(txData.user != address(0),          "Transaction does not exist");
        require(txData.user == msg.sender,           "Not the depositor");
        require(!txData.isCompleted,                 "Already completed");
        require(!txData.isCancelled,                 "Already cancelled");
        require(block.timestamp >= txData.createdAt + EXPIRY_DELAY, "Not yet expired");

        txData.isCancelled = true;
        IERC20(txData.token).safeTransfer(txData.user, txData.amount);

        emit ExpiredClaimed(txId, txData.user, txData.amount);
    }

    // ─── View ─────────────────────────────────────────────────────────────────
    function getTransaction(bytes32 txId) external view returns (Transaction memory) {
        return transactions[txId];
    }

    function isExpired(bytes32 txId) external view returns (bool) {
        Transaction storage txData = transactions[txId];
        return txData.user != address(0)
            && !txData.isCompleted
            && !txData.isCancelled
            && block.timestamp >= txData.createdAt + EXPIRY_DELAY;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────
    function _getActive(bytes32 txId) internal view returns (Transaction storage txData) {
        txData = transactions[txId];
        require(txData.user != address(0), "Transaction does not exist");
        require(!txData.isCompleted,       "Already completed");
        require(!txData.isCancelled,       "Already cancelled");
    }
}
