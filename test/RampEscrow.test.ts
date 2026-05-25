/**
 * test/RampEscrow.ts
 *
 * Suite de tests complète pour RampEscrow.sol
 *
 * Couvre :
 *   - Dépôt (deposit)
 *   - Complétion (completeTransaction)
 *   - Annulation (cancelTransaction)
 *   - Remboursement expiré (claimExpired)
 *   - Guards de sécurité (double dépôt, token non autorisé, etc.)
 *
 * Usage :
 *   npx hardhat test
 *   npx hardhat test --grep "claimExpired"
 */
import { expect }           from 'chai';
import { ethers }           from 'hardhat';
import { time }             from '@nomicfoundation/hardhat-network-helpers';
import type { Signer }      from 'ethers';
import type { RampEscrow }  from '../typechain-types';
import type { MockERC20 }   from '../typechain-types';

const EXPIRY_DELAY = 24 * 60 * 60; // 24 heures en secondes

describe('RampEscrow', function () {
  let escrow:   RampEscrow;
  let token:    MockERC20;
  let owner:    Signer;
  let user:     Signer;
  let platform: Signer;
  let stranger: Signer;

  let tokenAddress:  string;
  let escrowAddress: string;

  const DECIMALS = 6; // USDC/USDT = 6 décimales
  const amt      = (n: number) => ethers.parseUnits(String(n), DECIMALS);

  beforeEach(async () => {
    [owner, user, platform, stranger] = await ethers.getSigners();

    // Déployer MockERC20 (simule USDC)
    const Token = await ethers.getContractFactory('MockERC20');
    token = await Token.deploy('USD Coin', 'USDC', DECIMALS) as MockERC20;
    tokenAddress = await token.getAddress();

    // Minter 1000 USDC pour l'utilisateur
    await token.mint(await user.getAddress(), amt(1000));

    // Déployer RampEscrow
    const Escrow = await ethers.getContractFactory('RampEscrow');
    escrow = await Escrow.deploy(
      await platform.getAddress(),
      [tokenAddress]
    ) as RampEscrow;
    escrowAddress = await escrow.getAddress();
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Approuve + dépose `amount` USDC dans l'escrow pour `reference` */
  async function deposit(reference: string, amount: number, signer = user) {
    const txId = ethers.id(reference);
    await token.connect(signer).approve(escrowAddress, amt(amount));
    return escrow.connect(signer).deposit(txId, amt(amount), tokenAddress);
  }

  // ─── Constructor ───────────────────────────────────────────────────────────

  describe('Constructor', () => {
    it('initialise le platformWallet correctement', async () => {
      expect(await escrow.platformWallet()).to.equal(await platform.getAddress());
    });

    it('autorise le token fourni à la construction', async () => {
      expect(await escrow.allowedTokens(tokenAddress)).to.be.true;
    });

    it('émet TokenAllowed à la construction', async () => {
      const Escrow = await ethers.getContractFactory('RampEscrow');
      const tx = Escrow.deploy(await platform.getAddress(), [tokenAddress]);
      await expect(tx)
        .to.emit(await tx, 'TokenAllowed')
        .withArgs(tokenAddress, true);
    });

    it('rejette un platformWallet à zéro', async () => {
      const Escrow = await ethers.getContractFactory('RampEscrow');
      await expect(
        Escrow.deploy(ethers.ZeroAddress, [tokenAddress])
      ).to.be.revertedWith('Invalid platform wallet');
    });
  });

  // ─── deposit() ─────────────────────────────────────────────────────────────

  describe('deposit()', () => {
    it('verrouille les tokens et crée la transaction', async () => {
      await deposit('LR-TEST01', 100);
      const txId   = ethers.id('LR-TEST01');
      const stored = await escrow.getTransaction(txId);

      expect(stored.user).to.equal(await user.getAddress());
      expect(stored.amount).to.equal(amt(100));
      expect(stored.token).to.equal(tokenAddress);
      expect(stored.isCompleted).to.be.false;
      expect(stored.isCancelled).to.be.false;
    });

    it('émet Deposited avec les bons arguments', async () => {
      const txId = ethers.id('LR-TEST02');
      await token.connect(user).approve(escrowAddress, amt(50));
      await expect(escrow.connect(user).deposit(txId, amt(50), tokenAddress))
        .to.emit(escrow, 'Deposited')
        .withArgs(txId, await user.getAddress(), amt(50), tokenAddress);
    });

    it('transfère les tokens vers le contrat', async () => {
      const before = await token.balanceOf(escrowAddress);
      await deposit('LR-TEST03', 200);
      expect(await token.balanceOf(escrowAddress)).to.equal(before + amt(200));
    });

    it('rejette un montant de zéro', async () => {
      const txId = ethers.id('LR-ZERO');
      await token.connect(user).approve(escrowAddress, amt(0));
      await expect(
        escrow.connect(user).deposit(txId, 0n, tokenAddress)
      ).to.be.revertedWith('Amount must be > 0');
    });

    it('rejette un token non autorisé', async () => {
      const FakeToken = await ethers.getContractFactory('MockERC20');
      const fake = await FakeToken.deploy('Fake', 'FAKE', 18);
      const txId = ethers.id('LR-FAKE');
      await fake.mint(await user.getAddress(), amt(100));
      await fake.connect(user).approve(escrowAddress, amt(100));
      await expect(
        escrow.connect(user).deposit(txId, amt(100), await fake.getAddress())
      ).to.be.revertedWith('Token not allowed');
    });

    it('rejette un txId déjà utilisé (anti-doublon)', async () => {
      await deposit('LR-DUP01', 10);
      await expect(deposit('LR-DUP01', 20))
        .to.be.revertedWith('Transaction already exists');
    });
  });

  // ─── completeTransaction() ─────────────────────────────────────────────────

  describe('completeTransaction()', () => {
    it('transfère les tokens au platformWallet', async () => {
      await deposit('LR-COMP01', 100);
      const txId = ethers.id('LR-COMP01');

      const before = await token.balanceOf(await platform.getAddress());
      await escrow.connect(owner).completeTransaction(txId);
      expect(await token.balanceOf(await platform.getAddress())).to.equal(before + amt(100));
    });

    it('marque la transaction comme complétée', async () => {
      await deposit('LR-COMP02', 50);
      const txId = ethers.id('LR-COMP02');
      await escrow.connect(owner).completeTransaction(txId);
      const stored = await escrow.getTransaction(txId);
      expect(stored.isCompleted).to.be.true;
    });

    it('émet Completed', async () => {
      await deposit('LR-COMP03', 75);
      const txId = ethers.id('LR-COMP03');
      await expect(escrow.connect(owner).completeTransaction(txId))
        .to.emit(escrow, 'Completed')
        .withArgs(txId, await platform.getAddress(), amt(75));
    });

    it('rejette si appelé par non-owner', async () => {
      await deposit('LR-COMP04', 10);
      const txId = ethers.id('LR-COMP04');
      await expect(
        escrow.connect(stranger).completeTransaction(txId)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejette une transaction inexistante', async () => {
      const txId = ethers.id('LR-INEXISTANT');
      await expect(
        escrow.connect(owner).completeTransaction(txId)
      ).to.be.revertedWith('Transaction does not exist');
    });

    it('rejette une transaction déjà complétée', async () => {
      await deposit('LR-COMP05', 10);
      const txId = ethers.id('LR-COMP05');
      await escrow.connect(owner).completeTransaction(txId);
      await expect(
        escrow.connect(owner).completeTransaction(txId)
      ).to.be.revertedWith('Already completed');
    });
  });

  // ─── cancelTransaction() ───────────────────────────────────────────────────

  describe('cancelTransaction()', () => {
    it('rembourse les tokens à l'utilisateur', async () => {
      await deposit('LR-CANC01', 100);
      const txId = ethers.id('LR-CANC01');

      const before = await token.balanceOf(await user.getAddress());
      await escrow.connect(owner).cancelTransaction(txId);
      expect(await token.balanceOf(await user.getAddress())).to.equal(before + amt(100));
    });

    it('marque la transaction comme annulée', async () => {
      await deposit('LR-CANC02', 50);
      const txId = ethers.id('LR-CANC02');
      await escrow.connect(owner).cancelTransaction(txId);
      const stored = await escrow.getTransaction(txId);
      expect(stored.isCancelled).to.be.true;
    });

    it('émet Cancelled', async () => {
      await deposit('LR-CANC03', 30);
      const txId = ethers.id('LR-CANC03');
      await expect(escrow.connect(owner).cancelTransaction(txId))
        .to.emit(escrow, 'Cancelled')
        .withArgs(txId, await user.getAddress(), amt(30));
    });

    it('rejette si appelé par non-owner', async () => {
      await deposit('LR-CANC04', 10);
      const txId = ethers.id('LR-CANC04');
      await expect(
        escrow.connect(stranger).cancelTransaction(txId)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });

    it('rejette si déjà annulée', async () => {
      await deposit('LR-CANC05', 10);
      const txId = ethers.id('LR-CANC05');
      await escrow.connect(owner).cancelTransaction(txId);
      await expect(
        escrow.connect(owner).cancelTransaction(txId)
      ).to.be.revertedWith('Already cancelled');
    });
  });

  // ─── claimExpired() ────────────────────────────────────────────────────────

  describe('claimExpired()', () => {
    it('rembourse l'utilisateur après 24h', async () => {
      await deposit('LR-EXP01', 100);
      const txId = ethers.id('LR-EXP01');

      // Avancer le temps de 24h + 1 seconde
      await time.increase(EXPIRY_DELAY + 1);

      const before = await token.balanceOf(await user.getAddress());
      await escrow.connect(user).claimExpired(txId);
      expect(await token.balanceOf(await user.getAddress())).to.equal(before + amt(100));
    });

    it('marque la transaction comme annulée', async () => {
      await deposit('LR-EXP02', 50);
      const txId = ethers.id('LR-EXP02');
      await time.increase(EXPIRY_DELAY + 1);
      await escrow.connect(user).claimExpired(txId);
      const stored = await escrow.getTransaction(txId);
      expect(stored.isCancelled).to.be.true;
    });

    it('émet ExpiredClaimed', async () => {
      await deposit('LR-EXP03', 25);
      const txId = ethers.id('LR-EXP03');
      await time.increase(EXPIRY_DELAY + 1);
      await expect(escrow.connect(user).claimExpired(txId))
        .to.emit(escrow, 'ExpiredClaimed')
        .withArgs(txId, await user.getAddress(), amt(25));
    });

    it('rejette si pas encore expiré', async () => {
      await deposit('LR-EXP04', 10);
      const txId = ethers.id('LR-EXP04');
      // Avancer seulement 23h
      await time.increase(EXPIRY_DELAY - 3600);
      await expect(
        escrow.connect(user).claimExpired(txId)
      ).to.be.revertedWith('Not yet expired');
    });

    it('rejette si appelé par quelqu'un d'autre que le déposant', async () => {
      await deposit('LR-EXP05', 10);
      const txId = ethers.id('LR-EXP05');
      await time.increase(EXPIRY_DELAY + 1);
      await expect(
        escrow.connect(stranger).claimExpired(txId)
      ).to.be.revertedWith('Not the depositor');
    });

    it('rejette si déjà complétée', async () => {
      await deposit('LR-EXP06', 10);
      const txId = ethers.id('LR-EXP06');
      await escrow.connect(owner).completeTransaction(txId);
      await time.increase(EXPIRY_DELAY + 1);
      await expect(
        escrow.connect(user).claimExpired(txId)
      ).to.be.revertedWith('Already completed');
    });
  });

  // ─── isExpired() ───────────────────────────────────────────────────────────

  describe('isExpired()', () => {
    it('retourne false avant 24h', async () => {
      await deposit('LR-IE01', 10);
      const txId = ethers.id('LR-IE01');
      expect(await escrow.isExpired(txId)).to.be.false;
    });

    it('retourne true après 24h', async () => {
      await deposit('LR-IE02', 10);
      const txId = ethers.id('LR-IE02');
      await time.increase(EXPIRY_DELAY + 1);
      expect(await escrow.isExpired(txId)).to.be.true;
    });

    it('retourne false si complétée même après 24h', async () => {
      await deposit('LR-IE03', 10);
      const txId = ethers.id('LR-IE03');
      await escrow.connect(owner).completeTransaction(txId);
      await time.increase(EXPIRY_DELAY + 1);
      expect(await escrow.isExpired(txId)).to.be.false;
    });
  });

  // ─── Config (owner) ────────────────────────────────────────────────────────

  describe('Configuration owner', () => {
    it('setPlatformWallet met à jour l'adresse', async () => {
      const newWallet = await stranger.getAddress();
      await escrow.connect(owner).setPlatformWallet(newWallet);
      expect(await escrow.platformWallet()).to.equal(newWallet);
    });

    it('setPlatformWallet émet PlatformWalletUpdated', async () => {
      const oldWallet = await platform.getAddress();
      const newWallet = await stranger.getAddress();
      await expect(escrow.connect(owner).setPlatformWallet(newWallet))
        .to.emit(escrow, 'PlatformWalletUpdated')
        .withArgs(oldWallet, newWallet);
    });

    it('setPlatformWallet rejette l'adresse zéro', async () => {
      await expect(
        escrow.connect(owner).setPlatformWallet(ethers.ZeroAddress)
      ).to.be.revertedWith('Invalid address');
    });

    it('setTokenAllowed ajoute et retire un token', async () => {
      const FakeToken = await ethers.getContractFactory('MockERC20');
      const fake = await FakeToken.deploy('Fake', 'FAKE', 18);
      const fakeAddr = await fake.getAddress();

      expect(await escrow.allowedTokens(fakeAddr)).to.be.false;
      await escrow.connect(owner).setTokenAllowed(fakeAddr, true);
      expect(await escrow.allowedTokens(fakeAddr)).to.be.true;
      await escrow.connect(owner).setTokenAllowed(fakeAddr, false);
      expect(await escrow.allowedTokens(fakeAddr)).to.be.false;
    });

    it('setTokenAllowed rejette si non-owner', async () => {
      await expect(
        escrow.connect(stranger).setTokenAllowed(tokenAddress, false)
      ).to.be.revertedWithCustomError(escrow, 'OwnableUnauthorizedAccount');
    });
  });

  // ─── Scénario complet on-ramp / off-ramp ──────────────────────────────────

  describe('Scénario end-to-end', () => {
    it('off-ramp complet : dépôt → complétion → plateforme reçoit', async () => {
      const ref  = 'LR-E2E01';
      const txId = ethers.id(ref);

      // Utilisateur approuve + dépose 500 USDC
      await token.connect(user).approve(escrowAddress, amt(500));
      await escrow.connect(user).deposit(txId, amt(500), tokenAddress);

      // Vérification du solde escrow
      expect(await token.balanceOf(escrowAddress)).to.equal(amt(500));

      // Plateforme confirme le paiement FCFA → libère les tokens
      await escrow.connect(owner).completeTransaction(txId);

      // Platform wallet reçoit les 500 USDC
      expect(await token.balanceOf(await platform.getAddress())).to.equal(amt(500));
      expect(await token.balanceOf(escrowAddress)).to.equal(0n);

      // Transaction bien marquée complétée
      const stored = await escrow.getTransaction(txId);
      expect(stored.isCompleted).to.be.true;
    });

    it('off-ramp annulé : dépôt → annulation → utilisateur remboursé', async () => {
      const ref  = 'LR-E2E02';
      const txId = ethers.id(ref);

      const userBefore = await token.balanceOf(await user.getAddress());
      await token.connect(user).approve(escrowAddress, amt(200));
      await escrow.connect(user).deposit(txId, amt(200), tokenAddress);

      // Mobile Money échoue → annulation
      await escrow.connect(owner).cancelTransaction(txId);

      // Utilisateur récupère ses tokens
      expect(await token.balanceOf(await user.getAddress())).to.equal(userBefore);
    });

    it('trustless refund : dépôt → 24h → claimExpired sans action plateforme', async () => {
      const ref  = 'LR-E2E03';
      const txId = ethers.id(ref);

      const userBefore = await token.balanceOf(await user.getAddress());
      await token.connect(user).approve(escrowAddress, amt(150));
      await escrow.connect(user).deposit(txId, amt(150), tokenAddress);

      // Aucune action plateforme — temps s'écoule
      await time.increase(EXPIRY_DELAY + 1);

      // L'utilisateur se rembourse lui-même
      await escrow.connect(user).claimExpired(txId);
      expect(await token.balanceOf(await user.getAddress())).to.equal(userBefore);
    });
  });
});
