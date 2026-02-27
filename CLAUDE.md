# CLAUDE.md — MomoCandieNFT

AI assistant context for the **momomelis** repository. Read this before modifying any file.

---

## Project Overview

**MomoCandieNFT** is an ERC-721 NFT collection smart contract for Momo Candie — a cyberpunk-feminist femtech brand. The contract supports:

- Presale minting via Merkle-proof whitelist
- Public minting with per-wallet caps
- Reserve minting for team/DAO/giveaways
- On-chain metadata reveal
- DAO governance handoff

**Stack**: Solidity 0.8.26 · Hardhat · OpenZeppelin v5 · ethers v6 · Chai/Mocha · TypeChain

---

## Repository Structure

```
momomelis/
├── contracts/
│   └── MomoCandieNFT.sol       # Main ERC-721 contract (290 lines)
├── scripts/
│   └── deploy.js               # Deployment script with Merkle tree generation
├── test/
│   └── MomoCandieNFT.test.js   # Full test suite (~452 lines, 55+ cases)
├── .github/
│   └── auto_assign.yml         # PR auto-assignment routing matrix
├── .env.example                # Required environment variable template
├── .gitignore
├── hardhat.config.js           # Hardhat + Solidity + network config
├── index.html                  # Standalone canvas drawing tool (unrelated to contract)
├── jupiter-growth-fund.md      # Marketing strategy document
├── package.json
└── README.md                   # Brand profile for Momo Candie
```

---

## Smart Contract Architecture

**File**: `contracts/MomoCandieNFT.sol`

### Inheritance Chain

```
MomoCandieNFT
  ├── ERC721Enumerable (OpenZeppelin)
  ├── Ownable (OpenZeppelin)
  └── ReentrancyGuard (OpenZeppelin)
```

### Constants

| Name | Value | Purpose |
|---|---|---|
| `MAX_SUPPLY` | 3333 | Total token cap |
| `RESERVE_SUPPLY` | 111 | Team/DAO/giveaway allocation |
| `MAX_PER_WALLET` | 3 | Public sale per-wallet cap |
| `MAX_PRESALE_MINT` | 2 | Presale per-wallet cap |

### Sale Phases (enum `Phase`)

| Value | Name | Description |
|---|---|---|
| 0 | `Closed` | No minting allowed |
| 1 | `Presale` | Whitelist-only minting via Merkle proof |
| 2 | `Public` | Open minting for all addresses |

### Key State Variables

```solidity
Phase   public salePhase;             // Current sale phase
bool    public revealed;              // Whether metadata is revealed
bytes32 public merkleRoot;            // Merkle root for whitelist verification
string  private _baseTokenURI;        // Revealed base URI
string  public  unrevealedURI;        // Pre-reveal placeholder URI
address public daoMultisig;           // Target address for DAO handoff
uint256 private _reserveMinted;       // Count of reserve tokens minted
mapping(address => uint256) public presaleMintedCount;
mapping(address => uint256) public publicMintedCount;
```

### Minting Functions

- **`presaleMint(quantity, proof)`** — payable, `callerIsUser`, `nonReentrant`. Requires `Phase.Presale` and valid Merkle proof. Cap: `MAX_PRESALE_MINT` per wallet.
- **`publicMint(quantity)`** — payable, `callerIsUser`, `nonReentrant`. Requires `Phase.Public`. Cap: `MAX_PER_WALLET` per wallet lifetime.
- **`reserveMint(to, quantity)`** — `onlyOwner`. Draws from `RESERVE_SUPPLY`. Does not affect public allocation until reserve is partially used.

### Supply Accounting

Available public supply = `MAX_SUPPLY - (RESERVE_SUPPLY - _reserveMinted)`

As reserve tokens are minted, they free up public supply slots. This is the formula used in both `presaleMint` and `publicMint` supply checks.

### Token IDs

1-indexed, sequential. `_mintBatch` starts from `totalSupply() + 1`.

### Metadata

- Before reveal: all tokens return `unrevealedURI`
- After reveal: tokens return `_baseTokenURI + tokenId + ".json"`
- `reveal()` can only be called once (guarded by `revealed` flag)
- `setBaseURI()` can update the base URI after reveal (no guard)

### `callerIsUser` Modifier

```solidity
require(tx.origin == msg.sender, "Contracts not allowed");
```

Prevents contracts from calling minting functions directly.

### Events

| Event | Emitted When |
|---|---|
| `PhaseChanged(Phase)` | Phase is changed via `setPhase`, `openPresale`, `toggleSale`, `closeSale` |
| `Revealed(string)` | Metadata is revealed |
| `DAOHandoff(address, address)` | Ownership transferred to DAO |
| `MerkleRootUpdated(bytes32)` | Merkle root updated |
| `Withdrawal(address, uint256)` | ETH withdrawn |

### Admin Functions (all `onlyOwner`)

- `setPhase(Phase)` / `openPresale()` / `toggleSale()` / `closeSale()` — phase control
- `setMerkleRoot(bytes32)` — update whitelist root
- `reveal(string)` — one-time reveal with URI
- `setBaseURI(string)` — update base URI post-reveal
- `setUnrevealedURI(string)` — update placeholder URI
- `setPrices(uint256, uint256)` — update presale/public prices
- `setDAOMultisig(address)` — update DAO address
- `handoffToDAO()` — irrevocably transfer ownership to `daoMultisig`
- `withdraw()` — send ETH balance to owner
- `withdrawToDAO()` — send ETH balance to DAO multisig

---

## Development Workflows

### Initial Setup

```bash
npm install
cp .env.example .env
# edit .env with your values
```

### Run Tests

```bash
npx hardhat test
```

> Note: `npm test` is a placeholder and does not run Hardhat tests. Always use `npx hardhat test`.

### Test with Gas Report

```bash
REPORT_GAS=true npx hardhat test
```

### Test Coverage

```bash
npx hardhat coverage
```

### Deploy to Sepolia

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

The deploy script:
1. Generates a Merkle tree from a hardcoded whitelist array (update `whitelistAddresses` in `deploy.js` before deploying)
2. Deploys the contract with `UNREVEALED_URI`, computed Merkle root, and `DAO_MULTISIG`
3. Logs the contract address, Merkle root, and post-deployment checklist

### Verify on Etherscan

```bash
npx hardhat verify <CONTRACT_ADDRESS> "<UNREVEALED_URI>" "<MERKLE_ROOT>" "<DAO_MULTISIG>" --network sepolia
```

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `PRIVATE_KEY` | Yes (deploy) | Deployer wallet key (no `0x` prefix) |
| `SEPOLIA_RPC_URL` | Yes (deploy) | Sepolia RPC endpoint |
| `ETHERSCAN_API_KEY` | For verification | Etherscan API key |
| `CONTRACT_ADDRESS` | Post-deploy | Deployed contract address |
| `REPORT_GAS` | Optional | Set to any value to enable gas reporting |
| `UNREVEALED_URI` | Optional | IPFS URI for pre-reveal metadata |
| `DAO_MULTISIG` | Optional | DAO multisig address for deploy script |

**Never commit `.env`** — it is gitignored.

---

## Test Structure

**File**: `test/MomoCandieNFT.test.js`

Tests use Hardhat's built-in local network with `ethers` fixtures. The test file sets up a Merkle tree from a whitelist of signers to test presale proof verification.

### Test Suite Organization

| Describe Block | What It Covers |
|---|---|
| Deployment | Constructor args, initial state, zero-address guards |
| Phase Control | Phase transitions, owner-only enforcement |
| Presale Mint | Proof validation, caps, payment, phase guard |
| Public Mint | Open access, wallet caps, payment, phase guard |
| Reserve Mint | Owner-only, reserve cap, zero-address guard |
| Metadata Reveal | Pre/post reveal URIs, double-reveal guard |
| DAO Handoff | Ownership transfer, admin privilege change |
| Withdrawal | ETH withdraw to owner and DAO, empty-balance guard |
| Merkle Root Update | Owner update with event, non-owner rejection |
| Supply & View Functions | `remainingSupply()`, constant validation |
| Price Updates | `setPrices()` updates enforced on mint |

### Testing Patterns

- Revert assertions use `@nomicfoundation/hardhat-chai-matchers`: `.to.be.revertedWith("message")`
- Event assertions use `.to.emit(contract, "EventName").withArgs(...)`
- ETH value assertions use `.to.changeEtherBalance(address, delta)`
- Merkle proofs are generated in-test using `merkletreejs` + `keccak256`

---

## Code Conventions

### Solidity

- Solidity `^0.8.20` declared in contract; Hardhat compiles with `0.8.26`
- All OpenZeppelin imports from `@openzeppelin/contracts` v5
- Section dividers: `// ─────...─────` comments group related functions
- NatSpec `@notice` / `@param` on all public functions
- Prefer `external` over `public` for functions not called internally
- Revert strings are short, descriptive, consistent with test expectations — **do not change revert strings** without updating tests

### Testing

- Test file is plain JavaScript (not TypeScript)
- Use `loadFixture` pattern for consistent state between tests
- Each `it()` block should test exactly one behavior
- Add tests for any new contract function before or alongside the implementation

### Git

- Branch naming: `claude/<description>-<session-id>` for AI-generated branches
- Commit messages: imperative mood, descriptive, referencing what changed
- PRs use `.github/auto_assign.yml` for automatic reviewer assignment
- Draft PRs are excluded from auto-assignment (`skipDraftPr: true`)

---

## Important Constraints

1. **Do not modify revert strings** in the contract without updating the corresponding test assertions.
2. **Do not change token ID logic** — IDs are 1-indexed and sequential; tests assert specific IDs.
3. **`reveal()` is one-way** — once called, `revealed` cannot be reset. Any metadata update must use `setBaseURI()`.
4. **`handoffToDAO()` is irreversible** — the original owner loses all admin rights. Never call this in tests without a fresh fixture.
5. **Supply formula** — both `presaleMint` and `publicMint` use `MAX_SUPPLY - (RESERVE_SUPPLY - _reserveMinted)` as the effective cap. This must remain consistent between the two functions.
6. **`callerIsUser`** — EOA-only restriction on mint functions. Do not remove; it is security-critical.
7. **Prices default to** `0.03 ETH` (presale) and `0.05 ETH` (public). Tests rely on these defaults.

---

## Gitignored Artifacts

These are generated and should never be committed:

```
node_modules/
.env
artifacts/
cache/
coverage/
coverage.json
typechain/
typechain-types/
*.log
```

---

## PR & Review Routing

`.github/auto_assign.yml` routes reviews by file path:

| Changed Files | Reviewer(s) |
|---|---|
| `contracts/**/*.sol` | momomelis |
| `scripts/**/*.js` | momomelis |
| `test/**/*.js` | momomelis |

Draft PRs skip auto-assignment. Merge only after CI tests pass.
