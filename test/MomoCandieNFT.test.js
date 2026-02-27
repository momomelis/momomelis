const { expect } = require("chai");
const { ethers } = require("hardhat");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a merkle tree from signer addresses.
 * Returns { root, tree, proofFor }.
 */
function buildMerkleTree(signers) {
  const addresses = signers.map((s) => s.address);
  const leaves = addresses.map((addr) =>
    keccak256(Buffer.from(addr.replace("0x", ""), "hex"))
  );
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  const proofFor = (signer) => {
    const leaf = keccak256(
      Buffer.from(signer.address.replace("0x", ""), "hex")
    );
    return tree.getHexProof(leaf);
  };

  return { root, tree, proofFor };
}

const UNREVEALED_URI = "ipfs://QmUnrevealed/unrevealed.json";
const BASE_URI       = "ipfs://QmRevealed/";

// ─── Test suite ─────────────────────────────────────────────────────────────

describe("MomoCandieNFT", function () {
  let nft;
  let owner, dao, addr1, addr2, addr3, notWhitelisted;
  let merkleRoot, proofFor;

  beforeEach(async function () {
    [owner, dao, addr1, addr2, addr3, notWhitelisted] =
      await ethers.getSigners();

    // Whitelist: owner, addr1, addr2
    const whitelisted = [owner, addr1, addr2];
    ({ root: merkleRoot, proofFor } = buildMerkleTree(whitelisted));

    const MomoCandieNFT = await ethers.getContractFactory("MomoCandieNFT");
    nft = await MomoCandieNFT.deploy(UNREVEALED_URI, merkleRoot, dao.address);
    await nft.waitForDeployment();
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct name and symbol", async function () {
      expect(await nft.name()).to.equal("MomoCandieNFT");
      expect(await nft.symbol()).to.equal("MOMO");
    });

    it("sets the owner to the deployer", async function () {
      expect(await nft.owner()).to.equal(owner.address);
    });

    it("initialises with Phase.Closed", async function () {
      expect(await nft.salePhase()).to.equal(0); // Phase.Closed = 0
    });

    it("stores the unrevealed URI", async function () {
      expect(await nft.unrevealedURI()).to.equal(UNREVEALED_URI);
    });

    it("stores the DAO multisig", async function () {
      expect(await nft.daoMultisig()).to.equal(dao.address);
    });

    it("stores the merkle root", async function () {
      expect(await nft.merkleRoot()).to.equal(merkleRoot);
    });

    it("reverts deployment with zero-address DAO", async function () {
      const Factory = await ethers.getContractFactory("MomoCandieNFT");
      await expect(
        Factory.deploy(UNREVEALED_URI, merkleRoot, ethers.ZeroAddress)
      ).to.be.revertedWith("DAO multisig cannot be zero address");
    });
  });

  // ── Phase control ──────────────────────────────────────────────────────────

  describe("Phase control", function () {
    it("owner can open presale", async function () {
      await expect(nft.openPresale())
        .to.emit(nft, "PhaseChanged")
        .withArgs(1); // Phase.Presale = 1
      expect(await nft.salePhase()).to.equal(1);
    });

    it("owner can toggle to public sale", async function () {
      await nft.toggleSale();
      expect(await nft.salePhase()).to.equal(2); // Phase.Public = 2
    });

    it("owner can close sale", async function () {
      await nft.toggleSale();
      await nft.closeSale();
      expect(await nft.salePhase()).to.equal(0);
    });

    it("non-owner cannot change phase", async function () {
      await expect(nft.connect(addr1).openPresale()).to.be.reverted;
    });
  });

  // ── Presale mint ───────────────────────────────────────────────────────────

  describe("Presale mint", function () {
    const presalePrice = ethers.parseEther("0.03");

    beforeEach(async function () {
      await nft.openPresale();
    });

    it("whitelisted user can mint 1 token", async function () {
      const proof = proofFor(addr1);
      await expect(
        nft.connect(addr1).presaleMint(1, proof, { value: presalePrice })
      ).to.changeTokenBalance(nft, addr1, 1);
    });

    it("whitelisted user can mint up to MAX_PRESALE_MINT (2)", async function () {
      const proof = proofFor(addr1);
      await nft
        .connect(addr1)
        .presaleMint(2, proof, { value: presalePrice * 2n });
      expect(await nft.balanceOf(addr1.address)).to.equal(2);
    });

    it("reverts when exceeding presale cap", async function () {
      const proof = proofFor(addr1);
      await nft
        .connect(addr1)
        .presaleMint(2, proof, { value: presalePrice * 2n });
      await expect(
        nft.connect(addr1).presaleMint(1, proof, { value: presalePrice })
      ).to.be.revertedWith("Exceeds presale limit");
    });

    it("reverts with invalid merkle proof", async function () {
      const badProof = proofFor(addr1); // addr1's proof, used by notWhitelisted
      await expect(
        nft
          .connect(notWhitelisted)
          .presaleMint(1, badProof, { value: presalePrice })
      ).to.be.revertedWith("Not whitelisted");
    });

    it("reverts with insufficient payment", async function () {
      const proof = proofFor(addr1);
      await expect(
        nft
          .connect(addr1)
          .presaleMint(1, proof, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("reverts when phase is not Presale", async function () {
      await nft.closeSale();
      const proof = proofFor(addr1);
      await expect(
        nft.connect(addr1).presaleMint(1, proof, { value: presalePrice })
      ).to.be.revertedWith("Presale not active");
    });

    it("mints with correct sequential token IDs starting at 1", async function () {
      const proof1 = proofFor(addr1);
      const proof2 = proofFor(addr2);
      await nft.connect(addr1).presaleMint(1, proof1, { value: presalePrice });
      await nft.connect(addr2).presaleMint(1, proof2, { value: presalePrice });
      expect(await nft.ownerOf(1)).to.equal(addr1.address);
      expect(await nft.ownerOf(2)).to.equal(addr2.address);
    });

    it("tracks presaleMintedCount correctly", async function () {
      const proof = proofFor(addr1);
      await nft.connect(addr1).presaleMint(2, proof, { value: presalePrice * 2n });
      expect(await nft.presaleMintedCount(addr1.address)).to.equal(2);
    });
  });

  // ── Public mint ────────────────────────────────────────────────────────────

  describe("Public mint", function () {
    const publicPrice = ethers.parseEther("0.05");

    beforeEach(async function () {
      await nft.toggleSale();
    });

    it("enforces MAX_PER_WALLET across presale and public phases", async function () {
      await nft.openPresale();
      const proof = proofFor(addr1);
      const presalePrice = ethers.parseEther("0.03");
      await nft
        .connect(addr1)
        .presaleMint(2, proof, { value: presalePrice * 2n });

      await nft.toggleSale();
      const publicPrice = ethers.parseEther("0.05");
      await expect(
        nft.connect(addr1).publicMint(2, { value: publicPrice * 2n })
      ).to.be.revertedWith("Exceeds wallet limit");

      await nft.connect(addr1).publicMint(1, { value: publicPrice });
      expect(await nft.balanceOf(addr1.address)).to.equal(3);
    });

    it("any address can mint during public sale", async function () {
      await expect(
        nft.connect(notWhitelisted).publicMint(1, { value: publicPrice })
      ).to.changeTokenBalance(nft, notWhitelisted, 1);
    });

    it("allows up to MAX_PER_WALLET (3) tokens", async function () {
      await nft
        .connect(addr1)
        .publicMint(3, { value: publicPrice * 3n });
      expect(await nft.balanceOf(addr1.address)).to.equal(3);
    });

    it("reverts when exceeding wallet limit", async function () {
      await nft.connect(addr1).publicMint(3, { value: publicPrice * 3n });
      await expect(
        nft.connect(addr1).publicMint(1, { value: publicPrice })
      ).to.be.revertedWith("Exceeds wallet limit");
    });

    it("reverts with zero quantity", async function () {
      await expect(
        nft.connect(addr1).publicMint(0, { value: 0 })
      ).to.be.revertedWith("Invalid quantity");
    });

    it("reverts with quantity above 3", async function () {
      await expect(
        nft.connect(addr1).publicMint(4, { value: publicPrice * 4n })
      ).to.be.revertedWith("Invalid quantity");
    });

    it("reverts with insufficient payment", async function () {
      await expect(
        nft.connect(addr1).publicMint(2, { value: publicPrice })
      ).to.be.revertedWith("Insufficient payment");
    });

    it("reverts when phase is not Public", async function () {
      await nft.closeSale();
      await expect(
        nft.connect(addr1).publicMint(1, { value: publicPrice })
      ).to.be.revertedWith("Public sale not active");
    });

    it("tracks publicMintedCount correctly", async function () {
      await nft.connect(addr1).publicMint(2, { value: publicPrice * 2n });
      expect(await nft.publicMintedCount(addr1.address)).to.equal(2);
    });
  });

  // ── Reserve mint ───────────────────────────────────────────────────────────

  describe("Reserve mint", function () {
    it("owner can reserve mint to any address", async function () {
      await expect(nft.reserveMint(addr3.address, 5)).to.changeTokenBalance(
        nft,
        addr3,
        5
      );
      expect(await nft.reserveMinted()).to.equal(5);
    });

    it("reverts when exceeding RESERVE_SUPPLY (111)", async function () {
      await nft.reserveMint(addr3.address, 111);
      await expect(nft.reserveMint(addr3.address, 1)).to.be.revertedWith(
        "Exceeds reserve supply"
      );
    });

    it("reverts to zero address", async function () {
      await expect(
        nft.reserveMint(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("Zero address");
    });

    it("non-owner cannot reserve mint", async function () {
      await expect(nft.connect(addr1).reserveMint(addr1.address, 1)).to.be
        .reverted;
    });

    it("reserve does not consume public allocation", async function () {
      await nft.reserveMint(owner.address, 10);
      await nft.toggleSale();
      const publicPrice = ethers.parseEther("0.05");
      await nft.connect(addr1).publicMint(3, { value: publicPrice * 3n });
      expect(await nft.totalSupply()).to.equal(13);
    });
  });

  // ── Metadata reveal ────────────────────────────────────────────────────────

  describe("Metadata reveal", function () {
    beforeEach(async function () {
      await nft.reserveMint(owner.address, 1); // mint token 1
    });

    it("tokenURI returns unrevealedURI before reveal", async function () {
      expect(await nft.tokenURI(1)).to.equal(UNREVEALED_URI);
    });

    it("owner can reveal with a base URI", async function () {
      await expect(nft.reveal(BASE_URI))
        .to.emit(nft, "Revealed")
        .withArgs(BASE_URI);
      expect(await nft.revealed()).to.be.true;
    });

    it("tokenURI returns correct URI after reveal", async function () {
      await nft.reveal(BASE_URI);
      expect(await nft.tokenURI(1)).to.equal(`${BASE_URI}1.json`);
    });

    it("reverts double-reveal", async function () {
      await nft.reveal(BASE_URI);
      await expect(nft.reveal("ipfs://other/")).to.be.revertedWith(
        "Already revealed"
      );
    });

    it("non-owner cannot reveal", async function () {
      await expect(nft.connect(addr1).reveal(BASE_URI)).to.be.reverted;
    });

    it("tokenURI reverts for non-existent token", async function () {
      await expect(nft.tokenURI(999)).to.be.reverted;
    });
  });

  // ── DAO handoff ────────────────────────────────────────────────────────────

  describe("DAO handoff", function () {
    it("owner can hand off to DAO multisig", async function () {
      await expect(nft.handoffToDAO())
        .to.emit(nft, "DAOHandoff")
        .withArgs(owner.address, dao.address);
      expect(await nft.owner()).to.equal(dao.address);
    });

    it("after handoff, former owner loses admin rights", async function () {
      await nft.handoffToDAO();
      await expect(nft.toggleSale()).to.be.reverted;
    });

    it("after handoff, DAO multisig has admin rights", async function () {
      await nft.handoffToDAO();
      await expect(nft.connect(dao).toggleSale())
        .to.emit(nft, "PhaseChanged")
        .withArgs(2);
    });

    it("non-owner cannot hand off", async function () {
      await expect(nft.connect(addr1).handoffToDAO()).to.be.reverted;
    });
  });

  // ── Withdrawal ─────────────────────────────────────────────────────────────

  describe("Withdrawal", function () {
    beforeEach(async function () {
      await nft.toggleSale();
      const publicPrice = ethers.parseEther("0.05");
      await nft.connect(addr1).publicMint(1, { value: publicPrice });
    });

    it("owner can withdraw ETH to themselves", async function () {
      const balance = await ethers.provider.getBalance(await nft.getAddress());
      expect(balance).to.be.gt(0n);
      await expect(nft.withdraw()).to.changeEtherBalance(
        owner,
        balance
      );
    });

    it("owner can withdraw ETH to DAO", async function () {
      const balance = await ethers.provider.getBalance(await nft.getAddress());
      await expect(nft.withdrawToDAO()).to.changeEtherBalance(dao, balance);
    });

    it("reverts when balance is zero", async function () {
      await nft.withdraw();
      await expect(nft.withdraw()).to.be.revertedWith("Nothing to withdraw");
    });

    it("non-owner cannot withdraw", async function () {
      await expect(nft.connect(addr1).withdraw()).to.be.reverted;
    });
  });

  // ── Merkle root admin ──────────────────────────────────────────────────────

  describe("Merkle root update", function () {
    it("owner can update merkle root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newRoot"));
      await expect(nft.setMerkleRoot(newRoot))
        .to.emit(nft, "MerkleRootUpdated")
        .withArgs(newRoot);
      expect(await nft.merkleRoot()).to.equal(newRoot);
    });

    it("non-owner cannot update merkle root", async function () {
      const newRoot = ethers.keccak256(ethers.toUtf8Bytes("newRoot"));
      await expect(nft.connect(addr1).setMerkleRoot(newRoot)).to.be.reverted;
    });
  });

  // ── Supply & view functions ────────────────────────────────────────────────

  describe("Supply and view functions", function () {
    it("remainingSupply decreases with mints", async function () {
      const before = await nft.remainingSupply();
      await nft.reserveMint(owner.address, 5);
      const after = await nft.remainingSupply();
      expect(before - after).to.equal(5n);
    });

    it("MAX_SUPPLY is 3333", async function () {
      expect(await nft.MAX_SUPPLY()).to.equal(3333);
    });

    it("RESERVE_SUPPLY is 111", async function () {
      expect(await nft.RESERVE_SUPPLY()).to.equal(111);
    });

    it("MAX_PER_WALLET is 3", async function () {
      expect(await nft.MAX_PER_WALLET()).to.equal(3);
    });
  });

  // ── Price updates ──────────────────────────────────────────────────────────

  describe("Price updates", function () {
    it("owner can update prices", async function () {
      await nft.setPrices(
        ethers.parseEther("0.02"),
        ethers.parseEther("0.04")
      );
      expect(await nft.presalePrice()).to.equal(ethers.parseEther("0.02"));
      expect(await nft.publicPrice()).to.equal(ethers.parseEther("0.04"));
    });

    it("new presale price is enforced", async function () {
      await nft.setPrices(ethers.parseEther("0.02"), ethers.parseEther("0.04"));
      await nft.openPresale();
      const proof = proofFor(addr1);
      await expect(
        nft
          .connect(addr1)
          .presaleMint(1, proof, { value: ethers.parseEther("0.01") })
      ).to.be.revertedWith("Insufficient payment");
    });
  });
});
