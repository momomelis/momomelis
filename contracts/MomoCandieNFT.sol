// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MomoCandieNFT
 * @notice ERC-721 NFT collection for Momo Candie — cyberpunk-feminist femtech brand.
 *         Supports presale (merkle-whitelist), public sale, reserve mint,
 *         metadata reveal, DAO governance handoff, and emergency pause.
 */
contract MomoCandieNFT is ERC721Enumerable, Ownable, Pausable, ReentrancyGuard {
    using Strings for uint256;

    // ─────────────────────────────────────────────────────────────────────────
    //  Supply & pricing
    // ─────────────────────────────────────────────────────────────────────────

    uint256 public constant MAX_SUPPLY       = 3333;
    uint256 public constant RESERVE_SUPPLY   = 111;   // for team / DAO / giveaways
    uint256 public constant MAX_PER_WALLET   = 3;
    uint256 public constant MAX_PRESALE_MINT = 2;

    uint256 public presalePrice = 0.03 ether;
    uint256 public publicPrice  = 0.05 ether;

    // ─────────────────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────────────────

    enum Phase { Closed, Presale, Public }

    Phase   public salePhase;
    bool    public revealed;

    bytes32 public merkleRoot;

    string  private _baseTokenURI;
    string  public  unrevealedURI;

    address public daoMultisig;

    uint256 private _reserveMinted;

    // track per-wallet mints per phase to enforce caps
    mapping(address => uint256) public presaleMintedCount;
    mapping(address => uint256) public publicMintedCount;

    // ─────────────────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────────────────

    event PhaseChanged(Phase newPhase);
    event Revealed(string baseURI);
    event DAOHandoff(address indexed previousOwner, address indexed newOwner);
    event MerkleRootUpdated(bytes32 newRoot);
    event Withdrawal(address indexed to, uint256 amount);
    // L-1: missing setter events
    event UnrevealedURIUpdated(string uri);
    event BaseURIUpdated(string uri);
    event PricesUpdated(uint256 presalePrice, uint256 publicPrice);
    event DAOMultisigUpdated(address indexed dao);

    // ─────────────────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        string memory _unrevealedURI,
        bytes32       _merkleRoot,
        address       _daoMultisig
    ) ERC721("MomoCandieNFT", "MOMO") Ownable(msg.sender) {
        require(_daoMultisig != address(0), "DAO multisig cannot be zero address");
        unrevealedURI = _unrevealedURI;
        merkleRoot    = _merkleRoot;
        daoMultisig   = _daoMultisig;
        salePhase     = Phase.Closed;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev M-3 decision: tx.origin guard prevents contract callers from minting.
    ///      Intentional anti-bot measure. Remove or replace with an allowlist if
    ///      you need contract-to-contract minting (e.g. account-abstraction wallets).
    modifier callerIsUser() {
        require(tx.origin == msg.sender, "Contracts not allowed");
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin – phase control
    // ─────────────────────────────────────────────────────────────────────────

    function setPhase(Phase _phase) external onlyOwner {
        salePhase = _phase;
        emit PhaseChanged(_phase);
    }

    /// @notice Convenience alias: open presale
    function openPresale() external onlyOwner {
        salePhase = Phase.Presale;
        emit PhaseChanged(Phase.Presale);
    }

    /// @notice Convenience alias: open public sale
    function toggleSale() external onlyOwner {
        salePhase = Phase.Public;
        emit PhaseChanged(Phase.Public);
    }

    /// @notice Close all minting
    function closeSale() external onlyOwner {
        salePhase = Phase.Closed;
        emit PhaseChanged(Phase.Closed);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin – emergency stop (M-2)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Halt all minting and token transfers. Use in emergencies.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume normal operations after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Admin – metadata
    // ─────────────────────────────────────────────────────────────────────────

    function setMerkleRoot(bytes32 _root) external onlyOwner {
        merkleRoot = _root;
        emit MerkleRootUpdated(_root);
    }

    function setUnrevealedURI(string calldata _uri) external onlyOwner {
        unrevealedURI = _uri;
        emit UnrevealedURIUpdated(_uri);
    }

    function reveal(string calldata _uri) external onlyOwner {
        require(!revealed, "Already revealed");
        _baseTokenURI = _uri;
        revealed      = true;
        emit Revealed(_uri);
    }

    function setBaseURI(string calldata _uri) external onlyOwner {
        _baseTokenURI = _uri;
        emit BaseURIUpdated(_uri);
    }

    function setPrices(uint256 _presalePrice, uint256 _publicPrice) external onlyOwner {
        presalePrice = _presalePrice;
        publicPrice  = _publicPrice;
        emit PricesUpdated(_presalePrice, _publicPrice);
    }

    function setDAOMultisig(address _dao) external onlyOwner {
        require(_dao != address(0), "Zero address");
        daoMultisig = _dao;
        emit DAOMultisigUpdated(_dao);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  DAO handoff
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Transfer ownership to the DAO multisig.
     *         After this call the DAO controls all admin functions.
     */
    function handoffToDAO() external onlyOwner {
        // H-1: belt-and-suspenders — daoMultisig is validated on set, but
        // re-check here so this function is safe in isolation.
        require(daoMultisig != address(0), "DAO multisig not set");
        address previous = owner();
        _transferOwnership(daoMultisig);
        emit DAOHandoff(previous, daoMultisig);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Minting
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Presale mint – requires a valid merkle proof for the caller.
     * @param quantity  Number of tokens to mint (max MAX_PRESALE_MINT per address).
     * @param proof     Merkle proof verifying caller is whitelisted.
     */
    function presaleMint(uint256 quantity, bytes32[] calldata proof)
        external
        payable
        callerIsUser
        nonReentrant
        whenNotPaused
    {
        require(salePhase == Phase.Presale, "Presale not active");
        require(_verifyWhitelist(msg.sender, proof), "Not whitelisted");
        require(presaleMintedCount[msg.sender] + quantity <= MAX_PRESALE_MINT, "Exceeds presale limit");
        require(quantity <= _availableSupply(), "Exceeds max supply"); // H-2
        require(msg.value >= presalePrice * quantity, "Insufficient payment");

        presaleMintedCount[msg.sender] += quantity;
        _mintBatch(msg.sender, quantity);
    }

    /**
     * @notice Public mint – open to all EOAs.
     * @param quantity  Number of tokens to mint (max MAX_PER_WALLET per address over lifetime).
     */
    function publicMint(uint256 quantity)
        external
        payable
        callerIsUser
        nonReentrant
        whenNotPaused
    {
        require(salePhase == Phase.Public, "Public sale not active");
        require(quantity > 0 && quantity <= MAX_PER_WALLET, "Invalid quantity");
        require(publicMintedCount[msg.sender] + quantity <= MAX_PER_WALLET, "Exceeds wallet limit");
        require(quantity <= _availableSupply(), "Exceeds max supply"); // H-2
        require(msg.value >= publicPrice * quantity, "Insufficient payment");

        publicMintedCount[msg.sender] += quantity;
        _mintBatch(msg.sender, quantity);
    }

    /**
     * @notice Owner-only reserve mint for team, DAO, and giveaways.
     * @param to        Recipient address.
     * @param quantity  Number of tokens to mint.
     */
    function reserveMint(address to, uint256 quantity) external onlyOwner whenNotPaused {
        require(to != address(0), "Zero address");
        require(_reserveMinted + quantity <= RESERVE_SUPPLY, "Exceeds reserve supply");
        require(totalSupply() + quantity <= MAX_SUPPLY, "Exceeds max supply");

        _reserveMinted += quantity;
        _mintBatch(to, quantity);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _mintBatch(address to, uint256 quantity) internal {
        uint256 start = totalSupply() + 1; // 1-indexed token IDs
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(to, start + i);
        }
    }

    function _verifyWhitelist(address account, bytes32[] calldata proof)
        internal
        view
        returns (bool)
    {
        bytes32 leaf = keccak256(abi.encodePacked(account));
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }

    /**
     * @dev H-2: Returns how many tokens public/presale can still claim.
     *      Saturates at 0 rather than reverting on underflow, so callers
     *      always get a usable value even if the cap arithmetic runs dry.
     *
     *      cap  = MAX_SUPPLY − (RESERVE_SUPPLY − _reserveMinted)
     *           = tokens available to public/presale once the full reserve
     *             allocation is accounted for.
     *
     *      Both inner subtractions are safe:
     *        • reserveMint() enforces _reserveMinted ≤ RESERVE_SUPPLY
     *        • MAX_SUPPLY (3333) > RESERVE_SUPPLY (111) always
     */
    function _availableSupply() internal view returns (uint256) {
        uint256 reserved = RESERVE_SUPPLY - _reserveMinted;
        uint256 cap      = MAX_SUPPLY - reserved;
        uint256 minted   = totalSupply();
        return minted >= cap ? 0 : cap - minted;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Metadata
    // ─────────────────────────────────────────────────────────────────────────

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (!revealed) {
            return unrevealedURI;
        }
        return string(abi.encodePacked(_baseTokenURI, tokenId.toString(), ".json"));
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Finance
    // ─────────────────────────────────────────────────────────────────────────

    function withdraw() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        address recipient = owner(); // H-3: cache to avoid double owner() call
        (bool ok, ) = payable(recipient).call{value: balance}("");
        require(ok, "Withdrawal failed");
        emit Withdrawal(recipient, balance);
    }

    function withdrawToDAO() external onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance > 0, "Nothing to withdraw");
        (bool ok, ) = payable(daoMultisig).call{value: balance}("");
        require(ok, "Withdrawal failed");
        emit Withdrawal(daoMultisig, balance);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────────────────

    function reserveMinted() external view returns (uint256) {
        return _reserveMinted;
    }

    /// @notice How many tokens public/presale can still mint.
    ///         L-4: delegates to _availableSupply() for consistency with mint caps.
    function remainingSupply() external view returns (uint256) {
        return _availableSupply();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Overrides
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev M-2: Block all token movements (mints, transfers, burns) while paused.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        require(!paused(), "Contract is paused");
        return super._update(to, tokenId, auth);
    }

    /// @dev L-3: Explicit supportsInterface — correct across future Enumerable changes.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
