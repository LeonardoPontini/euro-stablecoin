# Euro Stablecoin - Technical Documentation

## Project Overview

This is an algorithmic stablecoin smart contract (EUROC) pegged to the Euro. It uses a **global multiplier system** for gas-efficient rebases and a **lock-up period** mechanism to prevent speculative sell-offs.

---

## File Structure

```
euro-stablecoin/
├── contracts/
│   └── EuroStablecoin.sol    # Main smart contract (290 lines)
├── test/
│   └── EuroStablecoin.test.js # Test suite (372 lines)
├── scripts/
│   └── deploy.js             # Deployment script (31 lines)
├── hardhat.config.js         # Hardhat configuration (37 lines)
└── package.json             # NPM dependencies (36 lines)
```

---

## 1. EuroStablecoin.sol - Smart Contract

### Imports (Lines 1-6)
```solidity
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
```
- **ERC20**: Standard token interface (name, symbol, decimals, transfer, etc.)
- **Ownable**: Restricts certain functions to the contract owner
- **Pausable**: Emergency stop mechanism

### Contract Declaration (Line 8)
```solidity
contract EuroStablecoin is ERC20, Ownable, Pausable {
```
Inherits from three OpenZeppelin contracts.

### Constants (Lines 9-10)
```solidity
uint256 public constant LOCK_DURATION = 7 days;
uint256 public constant MIN_REBASE_INTERVAL = 24 hours;
```
- **LOCK_DURATION**: Time tokens remain locked after positive rebase (7 days)
- **MIN_REBASE_INTERVAL**: Minimum time between rebases (24 hours)

### State Variables (Lines 12-20)
```solidity
uint256 internal _lastRebaseTime;
uint256 internal _rebaseMultiplier = 1e18;
mapping(address => uint256) internal _lockedRealBalances;
mapping(address => uint256) internal _lockEndTimes;
mapping(address => uint256) internal _lastRebaseSnapshot;
mapping(address => uint256) internal _realBalances;
mapping(address => bool) internal _isHolder;
address[] internal _holders;
```

| Variable | Purpose |
|----------|---------|
| `_lastRebaseTime` | Timestamp of last rebase operation |
| `_rebaseMultiplier` | Global multiplier (starts at 1e18 = 1.0) |
| `_realBalances` | User's actual token balance (base unit) |
| `_lockedRealBalances` | Locked tokens not yet claimable |
| `_lockEndTimes` | Unix timestamp when lock expires |
| `_lastRebaseSnapshot` | Multiplier value when user last transacted |
| `_isHolder` | Tracking if address has received tokens |
| `_holders` | Array of all token holders |

### Events (Lines 22-24)
```solidity
event RebaseApplied(address indexed caller, uint256 newMultiplier, int256 supplyDelta);
event LockupIssued(address indexed account, uint256 realAmount, uint256 unlockTime);
event LockupReleased(address indexed account, uint256 realAmount);
```
Events logged on blockchain for external monitoring.

### Custom Errors (Lines 26-29)
```solidity
error InvalidRebaseTime();
error InsufficientBalance();
error NothingToClaim();
error ZeroAddress();
```
Gas-efficient error handling (Solidity 0.8+).

### Constructor (Lines 31-36)
```solidity
constructor(address initialOwner) 
    ERC20("Euro Stablecoin", "EUROC") 
    Ownable(initialOwner) 
{
    _lastRebaseTime = block.timestamp;
}
```
Initializes token with name "Euro Stablecoin", symbol "EUROC", and sets deployer as owner.

### View Functions (Lines 38-67)

**globalMultiplier()** - Returns current multiplier
```solidity
function globalMultiplier() external view returns (uint256)
```

**balanceOf()** - Returns user's total balance (effective + claimable locked)
```solidity
function balanceOf(address account) public view override returns (uint256) {
    uint256 effective = _getEffectiveBalance(account);
    uint256 locked = _getClaimableLocked(account);
    uint256 lockedEffective = (locked * _rebaseMultiplier) / 1e18;
    return effective + lockedEffective;
}
```

**totalSupply()** - Returns total token supply from ERC20

### Internal Helper Functions (Lines 69-98)

**_getEffectiveBalance()** - Calculates balance with multiplier applied
```solidity
function _getEffectiveBalance(address account) internal view returns (uint256) {
    uint256 snapshot = _lastRebaseSnapshot[account];
    if (snapshot == 0) return 0;
    return (_realBalances[account] * _rebaseMultiplier) / snapshot;
}
```

**_getClaimableLocked()** - Returns locked balance if expired
```solidity
function _getClaimableLocked(address account) internal view returns (uint256) {
    if (block.timestamp >= _lockEndTimes[account]) {
        return _lockedRealBalances[account];
    }
    return 0;
}
```

**_syncAccount()** - Updates account to current multiplier
```solidity
function _syncAccount(address account) internal {
    uint256 snapshot = _lastRebaseSnapshot[account];
    if (snapshot != _rebaseMultiplier && snapshot != 0) {
        uint256 effective = (_realBalances[account] * _rebaseMultiplier) / snapshot;
        _realBalances[account] = effective;
        _lastRebaseSnapshot[account] = _rebaseMultiplier;
    }
}
```

**_checkAvailableBalance()** - Validates user has enough spendable balance

### Token Transfer Hook (Lines 101-123)
```solidity
function _update(address from, address to, uint256 amount) internal override {
    if (paused() && amount > 0) {
        revert Pausable.EnforcedPause();
    }
    
    if (from != address(0)) {
        _syncAccount(from);
        _checkAvailableBalance(from, amount);
        _realBalances[from] -= amount;
    }
    
    if (to != address(0)) {
        _syncAccount(to);
        _realBalances[to] += amount;
        _lastRebaseSnapshot[to] = _rebaseMultiplier;
        if (!_isHolder[to]) {
            _isHolder[to] = true;
            _holders.push(to);
        }
    }
    
    super._update(from, to, amount);
}
```
- Called on every transfer
- Syncs both sender and receiver to current multiplier
- Checks available (non-locked) balance
- Tracks new holders

### Minting & Burning (Lines 125-133)
```solidity
function mintBase(address to, uint256 amount) external onlyOwner {
    if (to == address(0)) revert ZeroAddress();
    _mint(to, amount);
}

function burnBase(address from, uint256 amount) external onlyOwner {
    if (from == address(0)) revert ZeroAddress();
    _burn(from, amount);
}
```
Only owner can mint/burn tokens.

### Rebase Function (Lines 156-197)

**The Core Algorithm:**

```solidity
function rebase(int256 supplyDelta) external onlyOwner whenNotPaused {
    // 1. Check minimum time interval
    if (block.timestamp < _lastRebaseTime + MIN_REBASE_INTERVAL) {
        revert InvalidRebaseTime();
    }
    
    uint256 total = ERC20.totalSupply();
    
    if (supplyDelta > 0) {
        // 2. POSITIVE REBASE: Expand supply
        uint256 newTotal = total + uint256(supplyDelta);
        uint256 oldMultiplier = _rebaseMultiplier;
        uint256 newMultiplier = (newTotal * 1e18) / total;
        
        // 3. Mint new tokens to contract
        _mint(address(this), uint256(supplyDelta));
        
        // 4. Distribute locked tokens proportionally
        for (uint256 i = 0; i < _holders.length; i++) {
            address holder = _holders[i];
            uint256 holderOldBalance = ...;
            uint256 share = (uint256(supplyDelta) * holderOldBalance) / total;
            _lockedRealBalances[holder] += share;
            _lockEndTimes[holder] = lockEnd;
        }
        
        _rebaseMultiplier = newMultiplier;
    } else if (supplyDelta < 0) {
        // 5. NEGATIVE REBASE: Contract supply
        uint256 absDelta = uint256(-supplyDelta);
        uint256 newTotal = total - absDelta;
        _rebaseMultiplier = (newTotal * 1e18) / total;
    }
    
    _lastRebaseTime = block.timestamp;
    emit RebaseApplied(...);
}
```

### Custom Lock Duration Rebase (Lines 199-245)
Same as `rebase()` but with configurable lock period (max 365 days).

### Claim Unlocked (Lines 247-265)
```solidity
function claimUnlocked() external whenNotPaused {
    if (block.timestamp < _lockEndTimes[account]) {
        revert NothingToClaim();
    }
    
    uint256 amount = _lockedRealBalances[account];
    if (amount == 0) revert NothingToClaim();
    
    _syncAccount(account);
    
    uint256 amountToAdd = (amount * _rebaseMultiplier) / 1e18;
    _realBalances[account] += amountToAdd;
    _lockedRealBalances[account] = 0;
    _lockEndTimes[account] = 0;
    
    emit LockupReleased(account, amountToAdd);
}
```

### Pause/Unpause (Lines 267-273)
```solidity
function pause() external onlyOwner { _pause(); }
function unpause() external onlyOwner { _unpause(); }
```

### View Functions (Lines 275-289)
```solidity
function getAccountState(address account) external view returns (...)
function holdersCount() external view returns (uint256)
```

---

## 2. EuroStablecoin.test.js - Test Suite

### Test Structure
```
30 tests organized in 11 describe blocks:
├── Basic Functionality (3 tests)
├── Minting and Balance (2 tests)
├── Global Multiplier - Positive Rebase (5 tests)
├── Global Multiplier - Negative Rebase (2 tests)
├── Lock-up Period (4 tests)
├── Custom Lock Duration (1 test)
├── Transfer Logic (2 tests)
├── Rebase Constraints (2 tests)
├── Pause Functionality (4 tests)
├── View Functions (1 test)
├── Extreme Scenarios (1 test)
└── Owner-Only Functions (3 tests)
```

### Helper Functions (Lines 5-16)
```javascript
function BN(a) { return BigInt(a); }  // Convert to BigInt

async function expectRevert(promise) {
  try {
    await promise;
    return false;  // Did NOT revert
  } catch (e) {
    return true;   // DID revert
  }
}
```

### Key Test Cases

**Balance Proportionality Test (Lines 86-98)**
```javascript
it("should maintain balance proportionally after rebase", async function () {
  const initialBalance1 = await euroStablecoin.balanceOf(user1.address);
  const initialBalance2 = await euroStablecoin.balanceOf(user2.address);
  const ratio = initialBalance1 / initialBalance2;  // e.g., 1:1
  
  await euroStablecoin.connect(owner).rebase(BN(200000));
  
  const newBalance1 = await euroStablecoin.balanceOf(user1.address);
  const newBalance2 = await euroStablecoin.balanceOf(user2.address);
  const newRatio = newBalance1 / newBalance2;
  
  expect(newRatio).to.equal(ratio);  // Still 1:1
});
```
**Verifies**: All holders' relative balances stay the same after rebase.

**Locked Token Prevention Test (Lines 110-121)**
```javascript
it("should not allow transfer of locked tokens", async function () {
  await euroStablecoin.connect(owner).rebase(BN(200000));
  
  const totalBalance = await euroStablecoin.balanceOf(user1.address);
  const locked = await euroStablecoin.lockedBalanceOf(user1.address);
  const available = totalBalance - locked;
  
  const didRevert = await expectRevert(
    euroStablecoin.connect(user1).transfer(user3.address, available + BN(1))
  );
  expect(didRevert).to.be.true;  // Transfer must fail
});
```
**Verifies**: Users cannot spend locked tokens during lock period.

---

## 3. deploy.js - Deployment Script

```javascript
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  
  console.log("Deploying with account:", deployer.address);
  
  const EuroStablecoin = await hre.ethers.getContractFactory("EuroStablecoin");
  const euroStablecoin = await EuroStablecoin.deploy(deployer.address);
  
  console.log("Deployed to:", await euroStablecoin.getAddress());
  
  // Verify deployment
  console.log("Name:", await euroStablecoin.name());
  console.log("Symbol:", await euroStablecoin.symbol());
  console.log("Multiplier:", await euroStablecoin.globalMultiplier());
}

main().then(() => process.exit(0)).catch(...);
```

**Flow:**
1. Get deployer account from Hardhat
2. Create contract factory
3. Deploy with deployer as owner
4. Log deployment address
5. Verify contract properties

---

## 4. hardhat.config.js - Configuration

```javascript
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: { chainId: 31337, time: 1704067200000 },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11155111
    }
  },
  gasReporter: { enabled: process.env.REPORT_GAS === "true", currency: "EUR" }
};
```

**Key Configurations:**
- **Solidity 0.8.20**: Latest stable version with built-in overflow checks
- **Optimizer**: Enabled with 200 runs for gas optimization
- **Hardhat Network**: Local EVM for testing (chainId 31337)
- **Sepolia**: Ethereum testnet for deployment
- **Gas Reporter**: Reports gas costs in EUR

---

## 5. package.json - Dependencies

### Dependencies
```json
"dependencies": {
  "@openzeppelin/contracts": "^5.0.0",
  "dotenv": "^16.3.1"
}
```

### DevDependencies
```json
"devDependencies": {
  "hardhat": "^2.19.0",
  "@nomicfoundation/hardhat-ethers": "^3.0.0",
  "chai": "^4.2.0"
}
```

### NPM Scripts
| Command | Action |
|---------|--------|
| `npm run compile` | Compile Solidity contracts |
| `npm test` | Run test suite |
| `npm run node` | Start local Hardhat node |
| `npm run deploy:local` | Deploy to local network |
| `npm run deploy:sepolia` | Deploy to Sepolia testnet |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     EuroStablecoin.sol                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────┐  │
│  │   ERC20     │    │   Ownable    │    │   Pausable     │  │
│  │  (inherit)  │    │  (inherit)   │    │   (inherit)    │  │
│  └─────────────┘    └──────────────┘    └────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    STATE VARIABLES                           │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  _rebaseMultiplier    │ 1e18 (starts at 1.0)      │    │
│  │  _realBalances        │ User base balances         │    │
│  │  _lockedRealBalances  │ Locked tokens             │    │
│  │  _lockEndTimes         │ Lock expiration           │    │
│  │  _holders[]            │ All token holders         │    │
│  └─────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                    CORE MECHANISMS                           │
│                                                              │
│  ┌────────────────────┐    ┌────────────────────────────┐   │
│  │  GLOBAL MULTIPLIER │    │       LOCK-UP PERIOD      │   │
│  │                    │    │                            │   │
│  │ balance = base ×    │    │ Positive Rebase:          │   │
│  │          multiplier │    │ - Mint new tokens          │   │
│  │                    │    │ - Lock for 7 days         │   │
│  │ Single update       │    │ - Prevent sell-offs       │   │
│  │ instead of iterating│    │                            │   │
│  │ all wallets        │    │ claimUnlocked():          │   │
│  │                    │    │ - After 7 days            │   │
│  └────────────────────┘    │ - Convert to spendable    │   │
│                            └────────────────────────────┘   │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │                    REBASE                           │     │
│  │                                                     │     │
│  │ Positive:  supply↑ → multiplier↑ → all balances↑    │     │
│  │ Negative:  supply↓ → multiplier↓ → all balances↓  │     │
│  │                                                     │     │
│  │ Formula: multiplier = (newTotal × 1e18) / oldTotal │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## Usage Flow Example

```javascript
// 1. Deploy contract
const token = await EuroStablecoin.deploy(owner);

// 2. Mint tokens to users
await token.mintBase(user1, 1000);

// 3. Positive rebase (expand supply)
await token.rebase(100);  // +10% supply
// → user1 balance increases proportionally
// → new tokens are LOCKED for 7 days

// 4. User tries to transfer locked tokens
await token.transfer(user2, 150);  // FAILS if >100 available

// 5. After 7 days, user claims unlocked
await token.claimUnlocked();  // Now can spend those tokens

// 6. Negative rebase (contract supply)
await token.rebase(-50);  // -5% supply
// → ALL balances decrease by 5%
```

---

## Security Considerations

1. **Reentrancy**: Protected via OpenZeppelin's Pausable
2. **Overflow**: Built-in Solidity 0.8+ checks
3. **Access Control**: OnlyOwner modifier on critical functions
4. **Pause Mechanism**: Emergency stop for all transfers
5. **Lock-up Period**: Prevents sudden sell-offs
6. **24-hour Rebase Cooldown**: Prevents rapid price manipulation
7. **Multiplier Bounds**: Prevents extreme multiplier values
