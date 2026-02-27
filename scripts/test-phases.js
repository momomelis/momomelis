/**
 * test-phases.js
 *
 * Interactive post-deployment phase walkthrough for MomoCandieNFT on Sepolia.
 * Runs all manual test steps in sequence:
 *   1. Presale mint  (whitelisted wallet)
 *   2. Public mint   (after toggleSale)
 *   3. Reserve mint  (owner only)
 *   4. Reveal        (metadata toggle)
 *   5. DAO handoff   (transfer ownership to multisig)
 *
 * Usage:
 *   CONTRACT_ADDRESS=0x... npx hardhat run scripts/test-phases.js --network sepolia
 */

const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
require("dotenv").config();

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMerkleTree(addresses) {
  const leaves = addresses.map((addr) =>
    keccak256(Buffer.from(addr.replace("0x", ""), "hex"))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return {
    root: tree.getHexRoot(),
    proofFor: (addr) => {
      const leaf = keccak256(Buffer.from(addr.replace("0x", ""), "hex"));
      return tree.getHexProof(leaf);
    },
  };
}

function log(section, msg) {
  console.log(`\n[${section}] ${msg}`);
}

function sep() {
  console.log("─".repeat(60));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("Set CONTRACT_ADDRESS in your .env or environment");
  }

  const [owner] = await ethers.getSigners();
  log("SETUP", `Operator wallet : ${owner.address}`);
  log("SETUP", `Contract        : ${contractAddress}`);
  log(
    "SETUP",
    `Balance         : ${ethers.formatEther(
      await ethers.provider.getBalance(owner.address)
    )} ETH`
  );

  const nft = await ethers.getContractAt("MomoCandieNFT", contractAddress);

  // ── Phase check ────────────────────────────────────────────────────────────
  const PHASE = ["Closed", "Presale", "Public"];
  const initialPhase = Number(await nft.salePhase());
  log("STATE", `Current phase   : ${PHASE[initialPhase]}`);
  log("STATE", `Total supply    : ${await nft.totalSupply()}`);
  log("STATE", `Remaining       : ${await nft.remainingSupply()}`);
  log("STATE", `Revealed        : ${await nft.revealed()}`);

  sep();

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1 — Presale mint (whitelisted wallet = owner for test purposes)
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n== STEP 1: Presale mint ==");

  // Build a single-address whitelist (owner is whitelisted for this walkthrough)
  const whitelistAddresses = [owner.address];
  const { root: newMerkleRoot, proofFor } = buildMerkleTree(whitelistAddresses);

  // Update merkle root if needed
  const storedRoot = await nft.merkleRoot();
  if (storedRoot !== newMerkleRoot) {
    log("PRESALE", `Updating merkle root to ${newMerkleRoot}`);
    const tx = await nft.setMerkleRoot(newMerkleRoot);
    await tx.wait();
    log("PRESALE", "Merkle root updated ✓");
  }

  // Open presale
  if (initialPhase !== 1) {
    log("PRESALE", "Opening presale...");
    const tx = await nft.openPresale();
    await tx.wait();
    log("PRESALE", `Phase is now: Presale ✓`);
  }

  const presalePrice = await nft.presalePrice();
  const proof = proofFor(owner.address);

  const presaleAlreadyMinted = await nft.presaleMintedCount(owner.address);
  if (presaleAlreadyMinted < 2n) {
    const qty = 2n - presaleAlreadyMinted;
    log("PRESALE", `Minting ${qty} token(s) at presale price (${ethers.formatEther(presalePrice)} ETH each)...`);
    const tx = await nft.presaleMint(qty, proof, {
      value: presalePrice * qty,
    });
    const receipt = await tx.wait();
    log("PRESALE", `Mint tx: ${receipt.hash}`);
    log("PRESALE", `Owner balance: ${await nft.balanceOf(owner.address)} NFT(s) ✓`);
  } else {
    log("PRESALE", `Already minted max presale allocation (${presaleAlreadyMinted}) ✓`);
  }

  sep();

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2 — Public mint (after toggleSale)
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n== STEP 2: Public mint ==");

  log("PUBLIC", "Toggling to public sale...");
  const toggleTx = await nft.toggleSale();
  await toggleTx.wait();
  log("PUBLIC", `Phase is now: Public ✓`);

  const publicPrice = await nft.publicPrice();
  const publicAlreadyMinted = await nft.publicMintedCount(owner.address);
  const maxPerWallet = await nft.MAX_PER_WALLET();
  const publicQty = maxPerWallet - publicAlreadyMinted;

  if (publicQty > 0n) {
    log("PUBLIC", `Minting ${publicQty} token(s) at public price (${ethers.formatEther(publicPrice)} ETH each)...`);
    const tx = await nft.publicMint(publicQty, {
      value: publicPrice * publicQty,
    });
    const receipt = await tx.wait();
    log("PUBLIC", `Mint tx: ${receipt.hash}`);
    log("PUBLIC", `Owner balance: ${await nft.balanceOf(owner.address)} NFT(s) ✓`);
  } else {
    log("PUBLIC", `Already reached MAX_PER_WALLET (${maxPerWallet}) in public mint ✓`);
  }

  sep();

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3 — Reserve mint (owner only, up to 111)
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n== STEP 3: Reserve mint ==");

  const reserveMintedBefore = await nft.reserveMinted();
  log("RESERVE", `Reserve minted so far: ${reserveMintedBefore} / 111`);

  if (reserveMintedBefore < 5n) {
    const reserveQty = 5n - reserveMintedBefore;
    log("RESERVE", `Minting ${reserveQty} reserve token(s) to owner...`);
    const tx = await nft.reserveMint(owner.address, reserveQty);
    const receipt = await tx.wait();
    log("RESERVE", `Reserve mint tx: ${receipt.hash}`);
    log("RESERVE", `Reserve minted: ${await nft.reserveMinted()} / 111 ✓`);
  } else {
    log("RESERVE", `Already minted ≥5 reserve tokens ✓`);
  }

  sep();

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4 — Reveal metadata
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n== STEP 4: Metadata reveal ==");

  const revealed = await nft.revealed();
  if (!revealed) {
    const baseURI = process.env.BASE_URI || "ipfs://QmYourRevealedCID/";
    log("REVEAL", `Revealing with base URI: ${baseURI}`);

    // Show unrevealed tokenURI first
    const totalSupply = await nft.totalSupply();
    if (totalSupply > 0n) {
      const unrevealedTokenURI = await nft.tokenURI(1);
      log("REVEAL", `Before reveal — tokenURI(1): ${unrevealedTokenURI}`);
    }

    const tx = await nft.reveal(baseURI);
    const receipt = await tx.wait();
    log("REVEAL", `Reveal tx: ${receipt.hash}`);

    // Confirm revealed tokenURI
    if (totalSupply > 0n) {
      const revealedTokenURI = await nft.tokenURI(1);
      log("REVEAL", `After reveal  — tokenURI(1): ${revealedTokenURI} ✓`);
    }
  } else {
    log("REVEAL", `Already revealed. Current base URI applied ✓`);
    const supply = await nft.totalSupply();
    if (supply > 0n) {
      log("REVEAL", `tokenURI(1): ${await nft.tokenURI(1)}`);
    }
  }

  sep();

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5 — DAO handoff
  // ───────────────────────────────────────────────────────────────────────────

  console.log("\n== STEP 5: DAO handoff ==");

  const daoMultisig = await nft.daoMultisig();
  const currentOwner = await nft.owner();
  log("DAO", `Current owner  : ${currentOwner}`);
  log("DAO", `DAO multisig   : ${daoMultisig}`);

  if (currentOwner.toLowerCase() === owner.address.toLowerCase()) {
    if (process.env.PERFORM_DAO_HANDOFF === "true") {
      log("DAO", "Transferring ownership to DAO multisig...");
      const tx = await nft.handoffToDAO();
      const receipt = await tx.wait();
      log("DAO", `Handoff tx: ${receipt.hash}`);
      log("DAO", `New owner: ${await nft.owner()} ✓`);
      log("DAO", "WARNING: Owner wallet no longer has admin rights.");
    } else {
      log(
        "DAO",
        "Skipping DAO handoff (set PERFORM_DAO_HANDOFF=true to execute)."
      );
      log("DAO", `When ready: PERFORM_DAO_HANDOFF=true CONTRACT_ADDRESS=${contractAddress} npx hardhat run scripts/test-phases.js --network sepolia`);
    }
  } else {
    log("DAO", `Ownership already transferred to ${currentOwner} ✓`);
  }

  sep();

  // ── Final summary ─────────────────────────────────────────────────────────

  console.log("\n== FINAL STATE ==");
  const finalPhase = PHASE[Number(await nft.salePhase())];
  const finalSupply = await nft.totalSupply();
  const finalRemaining = await nft.remainingSupply();
  const finalRevealed = await nft.revealed();
  const finalOwner = await nft.owner();
  const contractBalance = await ethers.provider.getBalance(contractAddress);

  log("SUMMARY", `Phase          : ${finalPhase}`);
  log("SUMMARY", `Total minted   : ${finalSupply}`);
  log("SUMMARY", `Remaining      : ${finalRemaining}`);
  log("SUMMARY", `Revealed       : ${finalRevealed}`);
  log("SUMMARY", `Contract owner : ${finalOwner}`);
  log("SUMMARY", `Contract ETH   : ${ethers.formatEther(contractBalance)} ETH`);
  log("SUMMARY", "All phase tests completed successfully ✓");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n[ERROR]", err.message || err);
    process.exit(1);
  });
