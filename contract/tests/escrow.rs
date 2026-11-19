//! End-to-end tests against the compiled module.
//! Build it first:  cargo concordium build --schema-embed --out ctp_escrow.wasm.v1
//! Then:            cargo test --test escrow
use concordium_smart_contract_testing::*;
use concordium_std::{AccountAddress, Amount, Duration, HashSha2256, Serial};
use ctp_escrow::*;
use sha2::{Digest, Sha256};

const ADMIN: AccountAddress = AccountAddress([1; 32]);
const RECEIVER: AccountAddress = AccountAddress([2; 32]);
const APPROVER: AccountAddress = AccountAddress([3; 32]);
const OTHER_SIGNER: AccountAddress = AccountAddress([4; 32]);
const SUPPLIER: AccountAddress = AccountAddress([5; 32]);
const PAYOUT: AccountAddress = AccountAddress([6; 32]);
const NEW_PAYOUT: AccountAddress = AccountAddress([7; 32]);
const AGENT: AccountAddress = AccountAddress([8; 32]);
const STRANGER: AccountAddress = AccountAddress([9; 32]);

const HOLD_MS: u64 = 72 * 3600 * 1000;
const ORDER: OrderId = 42;
const QTY: u64 = 100;
const PRICE: Amount = Amount::from_ccd(1_250);
const INVOICE: HashSha2256 = HashSha2256([0xaa; 32]);
const RECEIPT: HashSha2256 = HashSha2256([0xbb; 32]);
const SIGNER: Signer = Signer::with_one_key();
const ENERGY: Energy = Energy { energy: 100_000 };

struct T {
    chain: Chain,
    addr: ContractAddress,
    registry: ContractAddress,
}

/// Test-only registry entry (same layout as mock-registry's `Entry`).
#[derive(concordium_std::Serial)]
struct Entry {
    token_id: u64,
    owner: AccountAddress,
    active: bool,
}

impl T {
    fn call<P: Serial>(&mut self, who: AccountAddress, entry: &str, p: &P, amount: Amount) -> Result<ContractInvokeSuccess, ContractInvokeError> {
        self.chain.contract_update(SIGNER, who, Address::Account(who), ENERGY, UpdateContractPayload {
            amount,
            address: self.addr,
            receive_name: OwnedReceiveName::new_unchecked(format!("ctp_escrow.{entry}")),
            message: OwnedParameter::from_serial(p).expect("parameter"),
        })
    }
    fn ok<P: Serial>(&mut self, who: AccountAddress, entry: &str, p: &P) -> ContractInvokeSuccess {
        self.call(who, entry, p, Amount::zero()).unwrap_or_else(|e| panic!("{entry} failed: {:?}", e.parse_return_value::<Error>()))
    }
    fn err<P: Serial>(&mut self, who: AccountAddress, entry: &str, p: &P) -> Error {
        let e = self.call(who, entry, p, Amount::zero()).expect_err(&format!("{entry} should fail"));
        e.parse_return_value::<Error>().expect("contract error")
    }
    fn balance(&self, a: AccountAddress) -> Amount { self.chain.account_balance_available(a).unwrap() }
    /// Changes what the registry says about agent 1287.
    fn registry_says(&mut self, owner: AccountAddress, active: bool) {
        self.chain.contract_update(SIGNER, ADMIN, Address::Account(ADMIN), ENERGY, UpdateContractPayload {
            amount: Amount::zero(),
            address: self.registry,
            receive_name: OwnedReceiveName::new_unchecked("CIS-8004.set".into()),
            message: OwnedParameter::from_serial(&Entry { token_id: 1287, owner, active }).unwrap(),
        }).expect("registry set");
    }
    fn wait(&mut self, ms: u64) { self.chain.tick_block_time(Duration::from_millis(ms)).unwrap(); }
    fn decision(&self, r: &ContractInvokeSuccess) -> (Verdict, Vec<Code>, Option<AccountAddress>) {
        for (_, evs) in r.events() {
            for e in evs {
                if let Ok(Event::Decision { verdict, codes, paid_to, .. }) = e.parse::<Event>() {
                    return (verdict, codes, paid_to);
                }
            }
        }
        panic!("no Decision event");
    }
}

fn deploy_registry(chain: &mut Chain, entries: Vec<Entry>) -> ContractAddress {
    let m = module_load_v1("mock-registry/mock_registry.wasm.v1").expect("build the mock registry: cd mock-registry && cargo concordium build --out mock_registry.wasm.v1");
    let r = chain.module_deploy_v1(SIGNER, ADMIN, m).expect("deploy mock registry").module_reference;
    chain.contract_init(SIGNER, ADMIN, ENERGY, InitContractPayload {
        amount: Amount::zero(),
        mod_ref: r,
        init_name: OwnedContractName::new_unchecked("init_CIS-8004".into()),
        param: OwnedParameter::from_serial(&entries).unwrap(),
    }).expect("init mock registry").contract_address
}

fn commit_hash(who: AccountAddress, qty: u64, salt: [u8; 32]) -> HashSha2256 {
    HashSha2256(Sha256::digest(rules::commit_preimage(ORDER, &who.0, qty, &salt)).into())
}

/// Deploys, lists the signers and the agent, registers the supplier and funds one order.
fn setup() -> T { setup_with_order(PRICE) }

fn setup_with_order(escrow: Amount) -> T {
    let mut chain = Chain::new();
    for a in [ADMIN, RECEIVER, APPROVER, OTHER_SIGNER, SUPPLIER, PAYOUT, NEW_PAYOUT, AGENT, STRANGER] {
        chain.create_account(Account::new(a, Amount::from_ccd(10_000)));
    }
    let registry = deploy_registry(&mut chain, vec![Entry { token_id: 1287, owner: AGENT, active: true }]);
    let module = module_load_v1("ctp_escrow.wasm.v1").expect("build the module first: cargo concordium build --out ctp_escrow.wasm.v1");
    let deployed = chain.module_deploy_v1(SIGNER, ADMIN, module).expect("deploy");
    let init = chain.contract_init(SIGNER, ADMIN, ENERGY, InitContractPayload {
        amount: Amount::zero(),
        mod_ref: deployed.module_reference,
        init_name: OwnedContractName::new_unchecked("init_ctp_escrow".into()),
        param: OwnedParameter::from_serial(&InitParams { hold_ms: HOLD_MS, registry }).unwrap(),
    }).expect("init");
    let mut t = T { chain, addr: init.contract_address, registry };
    // The whole cast in one transaction.
    t.ok(ADMIN, "setup", &SetupParams {
        signers: vec![
            SignerParams { account: RECEIVER, role: Role::Receiver },
            SignerParams { account: APPROVER, role: Role::Approver },
            SignerParams { account: OTHER_SIGNER, role: Role::Receiver },
        ],
        agents: vec![AgentParams { account: AGENT, agent_token_id: 1287 }],
        suppliers: vec![SupplierParams { supplier: SUPPLIER, payout: PAYOUT }],
    });
    t.call(ADMIN, "create_order", &CreateOrderParams { order_id: ORDER, supplier: SUPPLIER, expected_qty: QTY, receiver: RECEIVER, approver: APPROVER }, escrow).expect("create_order");
    t
}

/// Both named signers count `qty`, the agent submits, the supplier approves.
fn happy_path_until_execute(t: &mut T, qty_r: u64, qty_a: u64) {
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, qty_r, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, qty_a, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_r, salt: sr });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_a, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
}

fn execute(t: &mut T) -> (Verdict, Vec<Code>, Option<AccountAddress>) {
    let r = t.ok(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT });
    t.decision(&r)
}

#[test]
fn clears_and_pays_the_registered_payout_after_the_hold() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    assert_eq!(execute(&mut t).1, vec![Code::HeldPayoutCoolOff]); // payout registered just now
    t.wait(HOLD_MS);
    let before = t.balance(PAYOUT);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
    assert_eq!(t.balance(PAYOUT), before + PRICE);
}

#[test]
fn a_paid_order_is_final() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    t.wait(HOLD_MS);
    execute(&mut t);
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::OrderClosed);
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::OrderClosed);
}

#[test]
fn counts_that_disagree_are_held_and_nothing_is_paid() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY - 10);
    t.wait(HOLD_MS);
    let before = t.balance(PAYOUT);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldCountMismatch], None));
    assert_eq!(t.balance(PAYOUT), before);
}

#[test]
fn invoice_without_supplier_approval_is_held() {
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t).1, vec![Code::HeldNoSupplierApproval]);
    // The supplier approving a different invoice does not help.
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: HashSha2256([0xcc; 32]), amount: PRICE });
    assert_eq!(execute(&mut t).1, vec![Code::HeldNoSupplierApproval]);
}

#[test]
fn only_the_supplier_can_approve_its_invoice() {
    let mut t = setup();
    for who in [ADMIN, AGENT, STRANGER] {
        assert_eq!(t.err(who, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::NotSupplier);
    }
}

#[test]
fn a_third_signer_cannot_join_or_block_an_order() {
    // Audit F-06: only the receiver and approver named on the order can count it.
    let mut t = setup();
    assert_eq!(t.err(OTHER_SIGNER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(OTHER_SIGNER, 0, [1; 32]) }), Error::NotOrderSigner);
}

#[test]
fn a_removed_signer_cannot_reveal_an_earlier_commit() {
    // Audit F-05.
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sa) });
    t.ok(ADMIN, "remove_signer", &RECEIVER);
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr }), Error::SignerNoLongerValid);
}

#[test]
fn reveals_wait_for_both_commits_and_must_match_them() {
    let mut t = setup();
    let sr = [11u8; 32];
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr }), Error::WaitingForSecondRole);
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, [22; 32]) });
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY + 1, salt: sr }), Error::RevealDoesNotMatchCommit);
}

#[test]
fn order_signers_must_be_two_listed_people_in_the_right_roles() {
    let mut t = setup();
    let p = |order_id, receiver, approver| CreateOrderParams { order_id, supplier: SUPPLIER, expected_qty: QTY, receiver, approver };
    for (id, r, a) in [(1, RECEIVER, RECEIVER), (2, APPROVER, RECEIVER), (3, STRANGER, APPROVER), (4, RECEIVER, OTHER_SIGNER)] {
        let e = t.call(ADMIN, "create_order", &p(id, r, a), PRICE).expect_err("bad signers");
        assert_eq!(e.parse_return_value::<Error>().unwrap(), Error::BadOrderSigners);
    }
}

#[test]
fn a_new_payout_account_restarts_the_hold_and_only_the_supplier_can_set_it() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    t.wait(HOLD_MS);
    assert_eq!(t.err(ADMIN, "set_payout", &NEW_PAYOUT), Error::NotSupplier);
    t.ok(SUPPLIER, "set_payout", &NEW_PAYOUT);
    assert_eq!(execute(&mut t).1, vec![Code::HeldPayoutCoolOff]);
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(NEW_PAYOUT)));
}

#[test]
fn only_the_submitting_registered_agent_can_ask_for_payment() {
    let mut t = setup();
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::NoInvoice);
    assert_eq!(t.err(STRANGER, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::NotAgent);
    happy_path_until_execute(&mut t, QTY, QTY);
    assert_eq!(t.err(STRANGER, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::NotAgent);
    t.ok(ADMIN, "remove_agent", &AGENT);
    t.wait(HOLD_MS);
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::NotAgent);
}

#[test]
fn wrong_invoice_amount_is_held() {
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: Amount::from_ccd(12_500) });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    // The invoice amount differs from the escrow, and from what the supplier approved.
    assert_eq!(execute(&mut t).1, vec![Code::HeldAmountMismatch, Code::HeldNoSupplierApproval]);
}

#[test]
fn refund_returns_the_escrow_to_the_buyer() {
    let mut t = setup();
    let before = t.balance(ADMIN);
    t.ok(ADMIN, "refund", &ORDER);
    assert!(t.balance(ADMIN) > before + PRICE - Amount::from_ccd(1)); // minus the fee
    assert_eq!(t.err(STRANGER, "refund", &ORDER), Error::NotAdmin);
}

#[test]
fn hold_outside_the_allowed_range_is_refused_at_init() {
    let mut chain = Chain::new();
    chain.create_account(Account::new(ADMIN, Amount::from_ccd(10_000)));
    let module = module_load_v1("ctp_escrow.wasm.v1").unwrap();
    let m = chain.module_deploy_v1(SIGNER, ADMIN, module).unwrap().module_reference;
    for hold_ms in [0, u64::MAX] {
        let r = chain.contract_init(SIGNER, ADMIN, ENERGY, InitContractPayload {
            amount: Amount::zero(),
            mod_ref: m,
            init_name: OwnedContractName::new_unchecked("init_ctp_escrow".into()),
            param: OwnedParameter::from_serial(&InitParams { hold_ms, registry: ContractAddress { index: 0, subindex: 0 } }).unwrap(),
        });
        assert!(r.is_err(), "hold {hold_ms} should be refused");
    }
}

#[test]
fn buyer_and_agent_cannot_underpay_the_supplier() {
    // The supplier's invoice is for PRICE. The buyer escrows less and the agent submits
    // the real invoice with the lower amount. The supplier approved PRICE, so it is held.
    let mut t = setup_with_order(Amount::from_ccd(1_000));
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: Amount::from_ccd(1_000) });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    let before = t.balance(PAYOUT);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldNoSupplierApproval], None));
    assert_eq!(t.balance(PAYOUT), before);
}

#[test]
fn setup_is_admin_only_and_refuses_a_supplier_twice() {
    let mut t = setup();
    let p = SetupParams { signers: vec![], agents: vec![], suppliers: vec![SupplierParams { supplier: STRANGER, payout: STRANGER }] };
    assert_eq!(t.err(STRANGER, "setup", &p), Error::NotAdmin);
    let again = SetupParams { signers: vec![], agents: vec![], suppliers: vec![SupplierParams { supplier: SUPPLIER, payout: NEW_PAYOUT }] };
    assert_eq!(t.err(ADMIN, "setup", &again), Error::SupplierExists);
}

#[test]
fn an_agent_the_registry_does_not_vouch_for_cannot_be_added() {
    let mut t = setup();
    // Wrong owner for token 1287.
    assert_eq!(t.err(ADMIN, "add_agent", &AgentParams { account: STRANGER, agent_token_id: 1287 }), Error::AgentNotVerified);
    // A token the registry does not know.
    assert_eq!(t.err(ADMIN, "add_agent", &AgentParams { account: AGENT, agent_token_id: 9999 }), Error::AgentNotVerified);
    // Revoked.
    t.registry_says(AGENT, false);
    assert_eq!(t.err(ADMIN, "add_agent", &AgentParams { account: AGENT, agent_token_id: 1287 }), Error::AgentNotVerified);
}

#[test]
fn a_revoked_agent_is_refused_at_once() {
    let mut t = setup();
    t.registry_says(AGENT, false);
    assert_eq!(t.err(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::AgentNotVerified);
    t.registry_says(AGENT, true);
    happy_path_until_execute(&mut t, QTY, QTY);
    t.wait(HOLD_MS);
    t.registry_says(AGENT, false);
    let before = t.balance(PAYOUT);
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::AgentNotVerified);
    assert_eq!(t.balance(PAYOUT), before);
}

#[test]
fn an_agent_transferred_to_someone_else_is_refused() {
    let mut t = setup();
    t.registry_says(STRANGER, true);
    assert_eq!(t.err(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::AgentNotVerified);
}

#[test]
fn a_junk_invoice_can_be_rejected_and_the_real_one_paid() {
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    // A hijacked agent jams the order with a junk invoice.
    let junk = HashSha2256([0xee; 32]);
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: junk, amount: PRICE });
    assert_eq!(t.err(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::InvoiceExists);
    // Strangers and the agent cannot clear it; the supplier can.
    assert_eq!(t.err(STRANGER, "reject_invoice", &ORDER), Error::NotAdmin);
    assert_eq!(t.err(AGENT, "reject_invoice", &ORDER), Error::NotAdmin);
    t.ok(SUPPLIER, "reject_invoice", &ORDER);
    // The real invoice goes through and is paid.
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn rejecting_clears_the_supplier_approval_too() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    t.ok(ADMIN, "reject_invoice", &ORDER);
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::NoInvoice);
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t).1, vec![Code::HeldNoSupplierApproval]);
}

#[test]
fn a_signer_cannot_copy_the_other_signers_seal() {
    // Self-audit 19 Nov: the seal includes the signer's account, so the approver
    // cannot reuse the receiver's public seal and echo the receiver's reveal.
    let mut t = setup();
    let sr = [11u8; 32];
    let seal = commit_hash(RECEIVER, QTY, sr);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: seal });
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: seal });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    // The receiver's count and key are now public; replaying them does not open the copy.
    assert_eq!(t.err(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr }), Error::RevealDoesNotMatchCommit);
}
