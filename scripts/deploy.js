const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
require("dotenv").config();

/**
 * Build a merkle tree from an array of addresses.
 * Returns { root, tree } where root is a 0x-prefixed hex string.
 */
function buildMerkleTree(addresses) {
  const leaves = addresses.map((addr) =>
    keccak256(Buffer.from(addr.replace("0x", ""), "hex"))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();
  return { root, tree };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );

  // ── Whitelist configuration ──────────────────────────────────────────────
  // Replace with real whitelist addresses before deployment.
  // For testing the deploy script itself, we use the deployer address.
  const whitelistAddresses = [
    deployer.address,
    // "0xAnotherWhitelistedAddress...",
  ];
  const { root: merkleRoot } = buildMerkleTree(whitelistAddresses);
  console.log("Merkle root:", merkleRoot);

  // ── DAO multisig ─────────────────────────────────────────────────────────
  // Replace with your actual Gnosis Safe / multisig address before production.
  const daoMultisig =
    process.env.DAO_MULTISIG || deployer.address;
  console.log("DAO multisig:", daoMultisig);

  // ── Deploy ────────────────────────────────────────────────────────────────
  const unrevealedURI =
    process.env.UNREVEALED_URI ||
    "ipfs://QmExampleUnrevealedCID/unrevealed.json";

  console.log("\nDeploying MomoCandieNFT...");
  const MomoCandieNFT = await ethers.getContractFactory("MomoCandieNFT");
  const nft = await MomoCandieNFT.deploy(
    unrevealedURI,
    merkleRoot,
    daoMultisig
  );
  await nft.waitForDeployment();

  const contractAddress = await nft.getAddress();
  console.log("MomoCandieNFT deployed to:", contractAddress);

  // ── Post-deploy summary ───────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("               DEPLOYMENT SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log("Contract address :", contractAddress);
  console.log("Merkle root      :", merkleRoot);
  console.log("DAO multisig     :", daoMultisig);
  console.log("Unrevealed URI   :", unrevealedURI);
  console.log("Network          :", (await ethers.provider.getNetwork()).name);
  console.log("Deployer         :", deployer.address);
  console.log("═══════════════════════════════════════════════════════");
  console.log("\nNext steps:");
  console.log(
    "  1. Verify:  npx hardhat verify --network sepolia",
    contractAddress,
    `"${unrevealedURI}"`,
    `"${merkleRoot}"`,
    `"${daoMultisig}"`
  );
  console.log("  2. Open presale:  openPresale()");
  console.log("  3. Toggle public: toggleSale()");
  console.log("  4. Reveal:        reveal('<baseURI>')");
  console.log("  5. DAO handoff:   handoffToDAO()");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
