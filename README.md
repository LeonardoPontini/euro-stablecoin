# Euro Stablecoin (EUROC)

Algorithmic stablecoin pegged to the Euro with global multiplier system and lock-up period mechanism.

## Features

- **Global Multiplier System**: Gas-efficient rebases without iterating all wallets
- **Lock-up Period**: Prevents speculative sell-offs (7 days default)
- **Rebase Mechanism**: Positive/negative supply adjustments
- **ERC20 Compatible**: Standard token interface
- **Pausable**: Emergency stop functionality

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests (30 tests)
npm test

# Start local Hardhat node
npm run node

# Deploy to local network (in another terminal)
npm run deploy:local

# Interactive terminal demo
npm run interact
```

## Project Structure

```
euro-stablecoin/
├── contracts/
│   └── EuroStablecoin.sol      # Main smart contract
├── test/
│   └── EuroStablecoin.test.js  # Test suite (30 tests)
├── scripts/
│   ├── deploy.js               # Deployment script
│   └── interact.js             # Interactive terminal demo
├── DOCUMENTATION.md            # Full technical documentation
├── hardhat.config.js           # Hardhat configuration
└── package.json               # Dependencies
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run compile` | Compile Solidity contracts |
| `npm run test` | Run test suite |
| `npm run node` | Start local Hardhat node |
| `npm run deploy:local` | Deploy to localhost |
| `npm run deploy:sepolia` | Deploy to Sepolia testnet |
| `npm run interact` | Interactive terminal demo |

## Contract Functions

### Owner Functions
```javascript
mintBase(address, amount)           // Mint new tokens
rebase(supplyDelta)                 // Positive: expand / Negative: contract
rebaseWithCustomLockup(delta, days) // Custom lock duration
pause() / unpause()                 // Emergency stop
```

### User Functions
```javascript
balanceOf(account)                   // Total balance (including locked)
lockedBalanceOf(account)            // Locked amount
lockEndTimeOf(account)              // When lock expires
claimUnlocked()                    // Claim after lock period
transfer(to, amount)               // Send tokens
```

### View Functions
```javascript
globalMultiplier()     // Current multiplier
totalSupply()          // Total token supply
baseBalanceOf(account) // Balance without multiplier
getAccountState(account) // Full account details
holdersCount()         // Number of holders
```

## Demo Output

The interactive demo shows:

1. **Initial Minting**: Create tokens for users
2. **Positive Rebase**: +10% supply expansion with 7-day lockup
3. **Transfer Restrictions**: Cannot spend locked tokens
4. **Exchange Simulation**: User-to-user transfers
5. **Negative Rebase**: -5% supply contraction
6. **Claim Unlocked**: Release tokens after lock expires
7. **Pause/Unpause**: Emergency stop functionality

## Deployment

### Local
```bash
npm run node
npm run deploy:local
```

### Sepolia Testnet
```bash
# Edit .env with your RPC URL and private key
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PRIVATE_KEY=your_private_key

npm run deploy:sepolia
```

## Contract Address

After deployment, the contract will be available at:
- Local: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- Sepolia: Check terminal output

View on Etherscan:
```
https://sepolia.etherscan.io/address/<CONTRACT_ADDRESS>
```

## Security

- OpenZeppelin ERC20, Ownable, Pausable
- Custom errors (gas-efficient)
- Reentrancy protection
- 24-hour rebase cooldown
- Multiplier bounds (0.01x - 100x)

## License

MIT
