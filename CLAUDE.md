# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

**MomoCandieNFT** is an ERC-721 NFT collection smart contract for Momo Candie — a cyberpunk-feminist femtech brand. The contract supports presale minting via Merkle-proof whitelist, public minting with per-wallet caps, reserve minting for team/DAO/giveaways, on-chain metadata reveal, emergency pause, and DAO governance handoff.

**Stack**: Solidity 0.8.26 · Hardhat 2.28.6 · OpenZeppelin 5.4.0 · ethers 6.16.0 · Chai/Mocha

---

## Commands

```bash
npm install
cp .env.example .env          # fill in PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY

npx hardhat compile
npx hardhat test                              # always use this, not npm test
npx hardhat test --grep "Presale"            # run a single describe/it block
REPORT_GAS=true npx hardhat test            # gas report in USD
npx hardhat coverage

npx hardhat run scripts/deploy.js --network sepolia
npx hardhat verify <ADDR> "<URI>" "<ROOT>" "<DAO>" --network sepolia

# Post-deploy live walkthrough on Sepolia (steps 1-5, skips DAO handoff by default):
CONTRACT_ADDRESS=0x... npx hardhat run scripts/test-phases.js --network sepolia
# To also execute the DAO handoff:
PERFORM_DAO_HANDOFF=true CONTRACT_ADDRESS=0x... npx hardhat run scripts/test-phases.js --network sepolia
```

---

## Smart Contract Architecture

**File**: `contracts/MomoCandieNFT.sol`

### Inheritance

```
MomoCandieNFT
  ├── ERC721Enumerable
  ├── Ownable
  ├── Pausable          ← blocks all mints + transfers via _update override
  └── ReentrancyGuard
```

### Constants

| Name | Value | Purpose |
|---|---|---|
| `MAX_SUPPLY` | 3333 | Total token cap |
| `RESERVE_SUPPLY` | 111 | Team/DAO/giveaway allocation |
| `MAX_PER_WALLET` | 3 | Public sale per-wallet cap |
| `MAX_PRESALE_MINT` | 2 | Presale per-wallet cap |

Prices default to `0.03 ETH` (presale) and `0.05 ETH` (public). Tests rely on these defaults.

### Sale Phases

`enum Phase { Closed, Presale, Public }` — starts at `Closed`.

### Supply Accounting

Both `presaleMint` and `publicMint` call `_availableSupply()`:

```
cap     = MAX_SUPPLY − (RESERVE_SUPPLY − _reserveMinted)
available = cap − totalSupply()   (saturates at 0)
```

As reserve tokens are minted, they free up public/presale slots. `remainingSupply()` (public view) delegates to this same `_availableSupply()` — it is **not** a naive `MAX_SUPPLY - totalSupply()`.

### Token IDs

1-indexed, sequential. `_mintBatch` starts from `totalSupply() + 1`.

### Metadata

- Pre-reveal: all tokens return `unrevealedURI`.
- Post-reveal: `_baseTokenURI + tokenId + ".json"` — so `_baseTokenURI` must end with `/` and the metadata files must be named `1.json`, `2.json`, etc.
- `reveal()` is one-way (guarded by `revealed` flag); post-reveal URI updates use `setBaseURI()`.

### `callerIsUser` Modifier

```solidity
require(tx.origin == msg.sender, "Contracts not allowed");
```

EOA-only guard on all mint functions. Do not remove — security-critical anti-bot measure. If account-abstraction wallets need to mint, replace with an explicit allowlist.

### Events

`PhaseChanged(Phase)` · `Revealed(string)` · `DAOHandoff(address, address)` · `MerkleRootUpdated(bytes32)` · `Withdrawal(address, uint256)` · `UnrevealedURIUpdated(string)` · `BaseURIUpdated(string)` · `PricesUpdated(uint256, uint256)` · `DAOMultisigUpdated(address)`

### Admin Functions (all `onlyOwner`)

Phase: `setPhase` / `openPresale()` / `toggleSale()` / `closeSale()`  
Pause: `pause()` / `unpause()`  
Metadata: `setMerkleRoot` · `reveal` · `setBaseURI` · `setUnrevealedURI`  
Finance: `setPrices` · `withdraw()` · `withdrawToDAO()`  
DAO: `setDAOMultisig` · `handoffToDAO()` — irrevocably transfers ownership; never call in tests without a fresh fixture.

---

## Scripts

| Script | Purpose |
|---|---|
| `scripts/deploy.js` | Generates Merkle tree from `whitelistAddresses` array, deploys contract, logs checklist. Update `whitelistAddresses` and set `DAO_MULTISIG` before mainnet deploy. |
| `scripts/test-phases.js` | Interactive Sepolia walkthrough: presale mint → public mint → reserve mint → reveal → DAO handoff. Requires `CONTRACT_ADDRESS`. DAO handoff step is gated behind `PERFORM_DAO_HANDOFF=true`. |

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `PRIVATE_KEY` | Deployer wallet key (no `0x` prefix) |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint |
| `ETHERSCAN_API_KEY` | Etherscan verification |
| `CONTRACT_ADDRESS` | Required by `test-phases.js` |
| `UNREVEALED_URI` | IPFS URI for pre-reveal placeholder |
| `BASE_URI` | Used by `test-phases.js` for the reveal step |
| `DAO_MULTISIG` | DAO multisig address for deploy |
| `PERFORM_DAO_HANDOFF` | Set to `true` in `test-phases.js` to execute handoff |
| `REPORT_GAS` | Any value enables gas reporting |

---

## Test Structure

**File**: `test/MomoCandieNFT.test.js` — plain JS, `beforeEach` fixtures (not `loadFixture`).

The test file builds its own Merkle tree from `[owner, addr1, addr2]` to test proof verification. Each `it()` tests exactly one behaviour.

- Reverts: `.to.be.revertedWith("message")` — **do not change revert strings** without updating tests.
- Events: `.to.emit(contract, "EventName").withArgs(...)`
- ETH deltas: `.to.changeEtherBalance(address, delta)`
- ERC-721 deltas: `.to.changeTokenBalance(nft, address, delta)`

---

## Important Constraints

1. **Do not change revert strings** without updating the matching test assertion.
2. **Token IDs are 1-indexed and sequential** — tests assert specific IDs.
3. **`reveal()` is one-way** — `revealed` flag cannot be reset; post-reveal URI changes use `setBaseURI()`.
4. **`handoffToDAO()` is irreversible** — never call in tests without a fresh deploy.
5. **Supply formula must stay consistent** — `_availableSupply()` is the single source of truth used by both mint functions and `remainingSupply()`. Do not inline a different formula.
6. **`callerIsUser` must stay on all mint functions** — see note in architecture section.

---

## Other Files

- `index.html` — standalone browser canvas drawing tool, unrelated to the contract.
- `dashboard.html` — MOMO Intelligence System, a standalone Tailwind-based frontend dashboard, unrelated to the contract.
- `jupiter-growth-fund.md` — marketing strategy document.
- `.github/auto_assign.yml` — routes PR reviews to `momomelis` for changes under `contracts/`, `scripts/`, and `test/`. Draft PRs skip auto-assignment.
