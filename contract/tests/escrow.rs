//! End-to-end tests against the compiled module.
//! Build it first:  cargo concordium build --schema-embed --out ctp_escrow.wasm.v1
//! Then:            cargo test --test escrow
use concordium_smart_contract_testing::*;
use concordium_std::{AccountAddress, Amount, Duration, HashSha2256, Serial, Timestamp};
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
/// The supplier's delivery rep (the driver), named by the supplier when it accepts.
const REP: AccountAddress = AccountAddress([10; 32]);
/// The neutral referee named on the order.
const REFEREE: AccountAddress = AccountAddress([11; 32]);
/// A second registered agent, not named on the test order.
const OTHER_AGENT: AccountAddress = AccountAddress([12; 32]);

const HOLD_MS: u64 = 72 * 3600 * 1000;
const ORDER: OrderId = 42;
/// The agreed deadline for the test order: 10 days after the chain starts.
const DUE_MS: u64 = 10 * 24 * 3600 * 1000;
const DUE: Timestamp = Timestamp::from_timestamp_millis(DUE_MS);
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
    /// Moves the chain clock past the order's agreed date.
    fn past_due(&mut self) {
        let now = self.chain.block_time().timestamp_millis();
        if now <= DUE_MS { self.wait(DUE_MS - now + 1); }
    }
    fn order(&mut self) -> Order {
        self.ok(STRANGER, "view_order", &ORDER).parse_return_value::<Order>().expect("order")
    }
    fn events(r: &ContractInvokeSuccess) -> Vec<Event> {
        r.events().flat_map(|(_, evs)| evs.iter().filter_map(|e| e.parse::<Event>().ok()).collect::<Vec<_>>()).collect()
    }
    fn asked_by(&self, r: &ContractInvokeSuccess) -> AccountAddress {
        for e in Self::events(r) {
            if let Event::Decision { asked_by, .. } = e { return asked_by; }
        }
        panic!("no Decision event");
    }
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

/// A seal for the first count round.
fn commit_hash(who: AccountAddress, qty: u64, salt: [u8; 32]) -> HashSha2256 { commit_hash_round(0, who, qty, salt) }

fn commit_hash_round(round: u8, who: AccountAddress, qty: u64, salt: [u8; 32]) -> HashSha2256 {
    HashSha2256(Sha256::digest(rules::commit_preimage(ORDER, round, &who.0, qty, &salt)).into())
}

/// Deploys, lists the signers and the agent, registers the supplier and funds one order.
fn setup() -> T { setup_with_order(PRICE) }

fn setup_with_order(escrow: Amount) -> T {
    let mut chain = Chain::new();
    for a in [ADMIN, RECEIVER, APPROVER, OTHER_SIGNER, SUPPLIER, PAYOUT, NEW_PAYOUT, AGENT, STRANGER, REP, REFEREE, OTHER_AGENT] {
        chain.create_account(Account::new(a, Amount::from_ccd(10_000)));
    }
    let registry = deploy_registry(&mut chain, vec![
        Entry { token_id: 1287, owner: AGENT, active: true },
        Entry { token_id: 1288, owner: OTHER_AGENT, active: true },
        Entry { token_id: 1289, owner: AGENT, active: true },
    ]);
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
            SignerParams { account: RECEIVER, role: Role::Receiver, person_tag: None, id_audit: None },
            SignerParams { account: APPROVER, role: Role::Approver, person_tag: None, id_audit: None },
            SignerParams { account: OTHER_SIGNER, role: Role::Receiver, person_tag: None, id_audit: None },
        ],
        agents: vec![AgentParams { account: AGENT, agent_token_id: 1287 }, AgentParams { account: OTHER_AGENT, agent_token_id: 1288 }],
        suppliers: vec![SupplierParams { supplier: SUPPLIER, payout: PAYOUT }],
    });
    t.call(ADMIN, "create_order", &order_params(ORDER), escrow).expect("create_order");
    t.ok(SUPPLIER, "accept_order", &AcceptParams { order_id: ORDER, invoice_by: DUE, rep: REP });
    t
}

fn order_params(order_id: OrderId) -> CreateOrderParams {
    CreateOrderParams { order_id, supplier: SUPPLIER, expected_qty: QTY, receiver: RECEIVER, approver: Some(APPROVER), invoice_by: DUE, agent: AGENT, referee: REFEREE }
}

/// The two gate counters (buyer's receiver, supplier's rep) seal and unseal, in the current round.
fn count(t: &mut T, qty_r: u64, qty_a: u64) {
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    let round = t.order().recounts;
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash_round(round, RECEIVER, qty_r, sr) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash_round(round, REP, qty_a, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_r, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_a, salt: sa });
}

/// The receiver and the supplier's rep count, the agent submits, the supplier approves.
fn happy_path_until_execute(t: &mut T, qty_r: u64, qty_a: u64) {
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, qty_r, sr) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, qty_a, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_r, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: qty_a, salt: sa });
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
    // Payout registered just now, and the approver's window after the gate counts is open.
    assert_eq!(execute(&mut t).1, vec![Code::HeldApproverWindow, Code::HeldPayoutCoolOff]);
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
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
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
fn removing_a_signer_does_not_break_an_order_under_way() {
    // Audit 20 Nov H1: the counters are fixed per order, so the buyer cannot remove its own
    // receiver to stop a delivery being confirmed.
    let mut t = setup();
    t.ok(ADMIN, "remove_signer", &RECEIVER);
    happy_path_until_execute(&mut t, QTY, QTY);
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
    // New orders cannot name a removed signer.
    assert_eq!(t.call(ADMIN, "create_order", &order_params(7), PRICE).expect_err("removed").parse_return_value::<Error>().unwrap(), Error::BadOrderSigners);
}

#[test]
fn reveals_wait_for_both_commits_and_must_match_them() {
    let mut t = setup();
    let sr = [11u8; 32];
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr }), Error::WaitingForSecondRole);
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, [22; 32]) });
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY + 1, salt: sr }), Error::RevealDoesNotMatchCommit);
}

#[test]
fn order_signers_must_be_two_listed_people_in_the_right_roles() {
    let mut t = setup();
    let p = |order_id, receiver, approver| CreateOrderParams { receiver, approver: Some(approver), ..order_params(order_id) };
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
fn only_the_submitting_agent_the_supplier_or_the_buyer_can_ask_for_payment() {
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
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: Amount::from_ccd(12_500) });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    // The invoice amount differs from the escrow, and from what the supplier approved.
    assert_eq!(execute(&mut t).1, vec![Code::HeldAmountMismatch, Code::HeldNoSupplierApproval]);
}

#[test]
fn the_buyer_can_refund_freely_until_the_supplier_accepts() {
    let mut t = setup();
    t.call(ADMIN, "create_order", &order_params(7), PRICE).expect("second order");
    let before = t.balance(ADMIN);
    assert_eq!(t.err(STRANGER, "refund", &7u64), Error::NotAdmin);
    t.ok(ADMIN, "refund", &7u64);
    assert!(t.balance(ADMIN) > before + PRICE - Amount::from_ccd(1)); // minus the fee
    // The accepted order is locked for the supplier.
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
}

#[test]
fn a_confirmed_delivery_with_an_approved_invoice_cannot_be_pulled_back() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    // Even after the date: it was ready in time, so the money is the supplier's.
    t.past_due();
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    // Nor can the buyer throw out the approved invoice to break it.
    assert_eq!(t.err(ADMIN, "reject_invoice", &ORDER), Error::InvoiceApprovedBySupplier);
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn after_the_date_an_unready_order_takes_nothing_new_and_the_buyer_can_refund() {
    let mut t = setup();
    count(&mut t, QTY, QTY);
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    // The supplier never approved in time.
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    t.past_due();
    assert_eq!(t.err(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::PastDeadline);
    let before = t.balance(ADMIN);
    t.ok(ADMIN, "refund", &ORDER);
    assert!(t.balance(ADMIN) > before + PRICE - Amount::from_ccd(1));
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::OrderClosed);
}

#[test]
fn no_counts_or_invoices_after_the_date() {
    let mut t = setup();
    t.past_due();
    assert_eq!(t.err(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [1; 32]) }), Error::PastDeadline);
    assert_eq!(t.err(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::PastDeadline);
}

#[test]
fn the_supplier_can_release_the_money_to_the_buyer() {
    let mut t = setup();
    assert_eq!(t.err(ADMIN, "release_to_buyer", &ORDER), Error::NotSupplier);
    assert_eq!(t.err(STRANGER, "release_to_buyer", &ORDER), Error::NotSupplier);
    let before = t.balance(ADMIN);
    t.ok(SUPPLIER, "release_to_buyer", &ORDER);
    assert_eq!(t.balance(ADMIN), before + PRICE);
    assert!(t.order().refunded);
}

#[test]
fn the_supplier_must_accept_before_approving_an_invoice() {
    let mut t = setup();
    t.call(ADMIN, "create_order", &order_params(7), PRICE).expect("second order");
    assert_eq!(t.err(SUPPLIER, "approve_invoice", &ApproveParams { order_id: 7, invoice_hash: INVOICE, amount: PRICE }), Error::OrderNotAccepted);
    assert_eq!(t.err(STRANGER, "accept_order", &AcceptParams { order_id: 7, invoice_by: DUE, rep: REP }), Error::NotSupplier);
    t.ok(SUPPLIER, "accept_order", &AcceptParams { order_id: 7, invoice_by: DUE, rep: REP });
    assert_eq!(t.err(SUPPLIER, "accept_order", &AcceptParams { order_id: 7, invoice_by: DUE, rep: REP }), Error::AlreadyAccepted);
}

#[test]
fn the_date_is_agreed_by_both_sides() {
    let mut t = setup();
    let later = Timestamp::from_timestamp_millis(DUE_MS * 2);
    let p = |invoice_by| DateParams { order_id: 7, invoice_by };
    // A date in the past is refused at creation.
    let past = CreateOrderParams { invoice_by: Timestamp::from_timestamp_millis(0), ..order_params(8) };
    assert_eq!(t.call(ADMIN, "create_order", &past, PRICE).expect_err("past date").parse_return_value::<Error>().unwrap(), Error::BadDate);
    // Before acceptance the buyer moves the date alone; the supplier must accept the current date.
    t.call(ADMIN, "create_order", &order_params(7), PRICE).expect("order 7");
    t.ok(ADMIN, "change_date", &p(later));
    assert_eq!(t.err(SUPPLIER, "accept_order", &AcceptParams { order_id: 7, invoice_by: DUE, rep: REP }), Error::DateChanged);
    t.ok(SUPPLIER, "accept_order", &AcceptParams { order_id: 7, invoice_by: later, rep: REP });
    // After acceptance one side proposes and the other must confirm the same date.
    let even_later = Timestamp::from_timestamp_millis(DUE_MS * 3);
    assert_eq!(t.err(STRANGER, "change_date", &p(even_later)), Error::NotOrderParty);
    assert_eq!(t.err(AGENT, "change_date", &p(even_later)), Error::NotOrderParty);
    t.ok(ADMIN, "change_date", &p(even_later));
    let view = |t: &mut T| t.ok(STRANGER, "view_order", &7u64).parse_return_value::<Order>().unwrap();
    assert_eq!(view(&mut t).invoice_by, later);
    // The same side repeating itself does not count as agreement.
    t.ok(ADMIN, "change_date", &p(even_later));
    assert_eq!(view(&mut t).invoice_by, later);
    t.ok(SUPPLIER, "change_date", &p(even_later));
    assert_eq!(view(&mut t).invoice_by, even_later);
    assert_eq!(view(&mut t).date_proposal, None);
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
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: Amount::from_ccd(1_000) });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    let before = t.balance(PAYOUT);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldNoSupplierApproval], None));
    assert_eq!(t.balance(PAYOUT), before);
}

#[test]
fn setup_is_admin_only_and_running_it_again_leaves_a_supplier_untouched() {
    let mut t = setup();
    let p = SetupParams { signers: vec![], agents: vec![], suppliers: vec![SupplierParams { supplier: STRANGER, payout: STRANGER }] };
    assert_eq!(t.err(STRANGER, "setup", &p), Error::NotAdmin);
    t.wait(HOLD_MS);
    let again = SetupParams { signers: vec![], agents: vec![], suppliers: vec![SupplierParams { supplier: SUPPLIER, payout: NEW_PAYOUT }] };
    t.ok(ADMIN, "setup", &again);
    assert_eq!(t.err(ADMIN, "register_supplier", &SupplierParams { supplier: SUPPLIER, payout: NEW_PAYOUT }), Error::SupplierExists);
    // Same payout account, hold not restarted.
    happy_path_until_execute(&mut t, QTY, QTY);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldApproverWindow], None));
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
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
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
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
    t.ok(SUPPLIER, "reject_invoice", &ORDER);
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
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: seal });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr });
    // The receiver's count and key are now public; replaying them does not open the copy.
    assert_eq!(t.err(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sr }), Error::RevealDoesNotMatchCommit);
}

#[test]
fn the_supplier_or_the_buyer_can_ask_for_payment_when_the_agent_is_offline() {
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    // Asking early changes nothing: the same rules hold the payment.
    let r = t.ok(SUPPLIER, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT });
    assert_eq!(t.decision(&r).1, vec![Code::HeldApproverWindow, Code::HeldPayoutCoolOff]);
    let r = t.ok(ADMIN, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT });
    assert_eq!(t.asked_by(&r), ADMIN);
    t.wait(HOLD_MS);
    let r = t.ok(SUPPLIER, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT });
    assert_eq!(t.decision(&r), (Verdict::Cleared, vec![], Some(PAYOUT)));
    assert_eq!(t.asked_by(&r), SUPPLIER);
}

#[test]
fn the_buyer_or_supplier_can_ask_for_a_recount_at_most_twice() {
    let mut t = setup();
    count(&mut t, QTY, QTY - 10);
    for who in [AGENT, RECEIVER, STRANGER] {
        assert_eq!(t.err(who, "recount", &ORDER), Error::NotOrderParty);
    }
    t.ok(SUPPLIER, "recount", &ORDER);
    let o = t.order();
    assert_eq!((o.commits.len(), o.reveals.len(), o.recounts), (0, 0, 1));
    count(&mut t, QTY - 10, QTY);
    t.ok(ADMIN, "recount", &ORDER);
    count(&mut t, QTY, QTY - 1);
    assert_eq!(t.err(SUPPLIER, "recount", &ORDER), Error::NoRecountsLeft);
}

#[test]
fn a_recount_fixes_an_honest_miscount_and_is_refused_when_counts_agree() {
    let mut t = setup();
    assert_eq!(t.err(ADMIN, "recount", &ORDER), Error::RecountNotNeeded);
    count(&mut t, QTY, QTY + 1);
    t.ok(ADMIN, "recount", &ORDER);
    count(&mut t, QTY, QTY);
    assert_eq!(t.err(ADMIN, "recount", &ORDER), Error::RecountNotNeeded);
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn the_admin_is_handed_over_in_two_steps() {
    let mut t = setup();
    assert_eq!(t.err(STRANGER, "propose_admin", &STRANGER), Error::NotAdmin);
    t.ok(ADMIN, "propose_admin", &NEW_PAYOUT);
    assert_eq!(t.err(STRANGER, "accept_admin", &()), Error::NotPendingAdmin);
    let r = t.ok(NEW_PAYOUT, "accept_admin", &());
    assert!(T::events(&r).contains(&Event::AdminChanged { from: ADMIN, to: NEW_PAYOUT }));
    assert_eq!(t.err(ADMIN, "add_signer", &SignerParams { account: STRANGER, role: Role::Receiver, person_tag: None, id_audit: None }), Error::NotAdmin);
    t.ok(NEW_PAYOUT, "add_signer", &SignerParams { account: STRANGER, role: Role::Receiver, person_tag: None, id_audit: None });
    // A pending proposal can be cancelled by proposing the current admin.
    t.ok(NEW_PAYOUT, "propose_admin", &STRANGER);
    t.ok(NEW_PAYOUT, "propose_admin", &NEW_PAYOUT);
    assert_eq!(t.err(STRANGER, "accept_admin", &()), Error::NotPendingAdmin);
}

#[test]
fn removals_are_logged() {
    let mut t = setup();
    let r = t.ok(ADMIN, "remove_signer", &RECEIVER);
    assert!(T::events(&r).contains(&Event::SignerRemoved { account: RECEIVER }));
    let r = t.ok(ADMIN, "remove_agent", &AGENT);
    assert!(T::events(&r).contains(&Event::AgentRemoved { account: AGENT }));
}

#[test]
fn the_buyers_counters_cannot_stall_a_delivered_order_into_a_refund() {
    // Audit 20 Nov H1: the rep counted the delivery, the buyer's receiver sealed but never
    // unsealed, and the date passed. The buyer cannot refund alone; the referee decides.
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.past_due();
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    // Only the referee rules.
    for who in [ADMIN, SUPPLIER, STRANGER, REP] {
        assert_eq!(t.err(who, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Delivered }), Error::NotReferee);
    }
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Delivered });
    // After a "delivered" ruling the invoice can still come in, even past the date.
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn the_referee_can_send_the_money_back_and_rules_only_on_a_real_dispute() {
    let mut t = setup();
    // Nothing counted by the rep yet: no dispute.
    assert_eq!(t.err(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund }), Error::NoDispute);
    count(&mut t, 40, QTY);
    let before = t.balance(ADMIN);
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund });
    assert_eq!(t.balance(ADMIN), before + PRICE);
    assert!(t.order().refunded);
    // A confirmed delivery is not a dispute.
    let mut t = setup();
    count(&mut t, QTY, QTY);
    assert_eq!(t.err(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund }), Error::NoDispute);
}

#[test]
fn without_the_reps_count_the_buyer_can_still_refund_after_the_date() {
    // The driver never counted (no unload): nothing was claimed delivered.
    let mut t = setup();
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [11; 32]) });
    t.past_due();
    t.ok(ADMIN, "refund", &ORDER);
}

#[test]
fn a_silent_approver_cannot_block_and_a_disagreeing_one_holds() {
    let mut t = setup();
    let sp = [33u8; 32];
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY - 5, sp) });
    happy_path_until_execute(&mut t, QTY, QTY);
    t.wait(HOLD_MS);
    // Sealed but silent: it does not block.
    let r = t.ok(SUPPLIER, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT });
    assert_eq!(t.decision(&r).0, Verdict::Cleared);
    // A second order where the approver unseals a different count is held.
    let mut t = setup();
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY - 5, sp) });
    happy_path_until_execute(&mut t, QTY, QTY);
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY - 5, salt: sp });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldCountMismatch], None));
}

#[test]
fn a_signer_can_replace_a_lost_seal_until_unsealing_starts() {
    // Audit 20 Nov H2.
    let mut t = setup();
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [1; 32]) });
    // The key for that seal is lost: seal again with a new one.
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [2; 32]) });
    assert_eq!(t.order().commits.len(), 1);
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, [3; 32]) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: [2; 32] });
    // Once anyone has unsealed, seals are final.
    assert_eq!(t.err(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, [4; 32]) }), Error::AlreadyCommitted);
}

#[test]
fn a_recount_is_possible_when_a_sealed_count_is_never_unsealed() {
    // Audit 20 Nov H2: a lost key no longer stalls the order until the date.
    let mut t = setup();
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [1; 32]) });
    assert_eq!(t.err(SUPPLIER, "recount", &ORDER), Error::RecountNotNeeded);
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, [3; 32]) });
    t.ok(SUPPLIER, "recount", &ORDER);
    count(&mut t, QTY, QTY);
    assert!(t.order().reveals.len() == 2);
}

#[test]
fn a_seal_from_an_earlier_round_does_not_open_after_a_recount() {
    // Audit 20 Nov L8: the round is inside the seal.
    let mut t = setup();
    count(&mut t, QTY, QTY - 1);
    t.ok(ADMIN, "recount", &ORDER);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [11; 32]) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash_round(1, REP, QTY, [22; 32]) });
    assert_eq!(t.err(RECEIVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: [11; 32] }), Error::RevealDoesNotMatchCommit);
}

#[test]
fn only_the_agent_named_on_the_order_can_invoice_it() {
    // Audit 20 Nov M5.
    let mut t = setup();
    assert_eq!(t.err(OTHER_AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE }), Error::NotOrderAgent);
    let bad = CreateOrderParams { agent: STRANGER, ..order_params(7) };
    assert_eq!(t.call(ADMIN, "create_order", &bad, PRICE).expect_err("unregistered agent").parse_return_value::<Error>().unwrap(), Error::NotAgent);
}

#[test]
fn payment_checks_the_token_on_the_invoice() {
    // Audit 20 Nov L7.
    let mut t = setup();
    happy_path_until_execute(&mut t, QTY, QTY);
    t.ok(ADMIN, "add_agent", &AgentParams { account: AGENT, agent_token_id: 1289 });
    t.wait(HOLD_MS);
    assert_eq!(t.err(AGENT, "execute_payment", &ExecuteParams { order_id: ORDER, receipt_hash: RECEIPT }), Error::NotAgent);
}

#[test]
fn referee_and_rep_must_be_independent_and_orders_need_a_quantity() {
    let mut t = setup();
    for who in [ADMIN, SUPPLIER, RECEIVER, APPROVER, AGENT] {
        let p = CreateOrderParams { referee: who, ..order_params(7) };
        assert_eq!(t.call(ADMIN, "create_order", &p, PRICE).expect_err("bad referee").parse_return_value::<Error>().unwrap(), Error::BadReferee);
    }
    let zero = CreateOrderParams { expected_qty: 0, ..order_params(8) };
    assert_eq!(t.call(ADMIN, "create_order", &zero, PRICE).expect_err("zero").parse_return_value::<Error>().unwrap(), Error::ZeroQuantity);
    t.call(ADMIN, "create_order", &order_params(9), PRICE).expect("order 9");
    for who in [ADMIN, RECEIVER, APPROVER, REFEREE, AGENT] {
        assert_eq!(t.err(SUPPLIER, "accept_order", &AcceptParams { order_id: 9, invoice_by: DUE, rep: who }), Error::BadRep);
    }
    // A small supplier can deliver and count itself.
    t.ok(SUPPLIER, "accept_order", &AcceptParams { order_id: 9, invoice_by: DUE, rep: SUPPLIER });
}

#[test]
fn date_proposals_belong_to_a_side_expire_and_can_be_withdrawn() {
    // Audit 20 Nov L6.
    let mut t = setup();
    let later = Timestamp::from_timestamp_millis(DUE_MS * 2);
    let d = |invoice_by| DateParams { order_id: ORDER, invoice_by };
    // A new buyer admin cannot confirm the old admin's proposal: same side.
    t.ok(ADMIN, "change_date", &d(later));
    t.ok(ADMIN, "propose_admin", &NEW_PAYOUT);
    t.ok(NEW_PAYOUT, "accept_admin", &());
    t.ok(NEW_PAYOUT, "change_date", &d(later));
    assert_eq!(t.order().invoice_by, DUE);
    // The proposer withdraws it by proposing the current date.
    t.ok(NEW_PAYOUT, "change_date", &d(DUE));
    assert_eq!(t.order().date_proposal, None);
    // A proposal lapses after 7 days.
    t.ok(NEW_PAYOUT, "change_date", &d(later));
    t.wait(8 * 24 * 3600 * 1000);
    t.ok(SUPPLIER, "change_date", &d(later));
    assert_eq!(t.order().invoice_by, DUE);
    assert_eq!(t.order().date_proposal.map(|p| p.by), Some(Side::Supplier));
}

#[test]
fn refunds_go_back_to_the_account_that_funded_the_order() {
    // Audit 20 Nov L11.
    let mut t = setup();
    t.ok(ADMIN, "propose_admin", &NEW_PAYOUT);
    t.ok(NEW_PAYOUT, "accept_admin", &());
    let before = t.balance(ADMIN);
    t.ok(SUPPLIER, "release_to_buyer", &ORDER);
    assert_eq!(t.balance(ADMIN), before + PRICE);
}

#[test]
fn two_signers_proven_to_be_the_same_person_cannot_share_an_order() {
    let mut t = setup();
    let tag = Some(HashSha2256([0x5a; 32]));
    t.ok(ADMIN, "add_signer", &SignerParams { account: RECEIVER, role: Role::Receiver, person_tag: tag, id_audit: None });
    t.ok(ADMIN, "add_signer", &SignerParams { account: APPROVER, role: Role::Approver, person_tag: tag, id_audit: None });
    assert_eq!(t.call(ADMIN, "create_order", &order_params(7), PRICE).expect_err("same person").parse_return_value::<Error>().unwrap(), Error::SamePerson);
    t.ok(ADMIN, "add_signer", &SignerParams { account: APPROVER, role: Role::Approver, person_tag: Some(HashSha2256([0x5b; 32])), id_audit: None });
    t.call(ADMIN, "create_order", &order_params(7), PRICE).expect("two people");
    // The supplier's rep is never a listed signer.
    assert_eq!(t.err(ADMIN, "add_signer", &SignerParams { account: REP, role: Role::SupplierRep, person_tag: None, id_audit: None }), Error::BadOrderSigners);
}

/// The app's decoders (app/src/codec.js) are tested against test/fixtures/escrow-bytes.json.
/// This checks those bytes are exactly what this contract serializes, for the demo cast.
#[test]
fn app_fixture_bytes_match_the_contract() {
    fn acct(h: &str) -> AccountAddress {
        let mut a = [0u8; 32];
        for i in 0..32 { a[i] = u8::from_str_radix(&h[2 * i..2 * i + 2], 16).unwrap(); }
        AccountAddress(a)
    }
    let hx = |b: Vec<u8>| b.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let buyer = acct("c18d8baf7911c2673f65a215b5673e901a79a05eacbd5b9eb8ebbd6ef39b2ce9");
    let r = acct("3900161da3685ee48a31571568a1261e2839719236ff21a07b9cccca4204f5bc");
    let ap = acct("56d0603ba8cfcc2cd40be73f4878e67c94b63c81d4334fc45af61afb90550dd4");
    let s = acct("94cd48982af6a75401e88b8b608aaf649ac58d1177fb5569a608a3365ff744ae");
    let ag = acct("9278f55e8366c065c474c07146d2eedea12cdbe67ee9f9c532922aa9858011b8");
    let ccd25 = Amount::from_micro_ccd(25_000_000);
    let full = Order {
        supplier: s, receiver: r, approver: Some(ap), expected_qty: 100, amount: ccd25,
        commits: vec![
            Commit { signer: r, role: Role::Receiver, hash: HashSha2256([0x11; 32]) },
            Commit { signer: ap, role: Role::Approver, hash: HashSha2256([0x22; 32]) },
        ],
        reveals: vec![RevealedCount { signer: r, role: Role::Receiver, qty: 100 }],
        invoice: Some(Invoice { agent: ag, agent_token_id: 1287, invoice_hash: HashSha2256([0xcd; 32]), amount: ccd25 }),
        supplier_approval: Some(Approval { invoice_hash: HashSha2256([0xcd; 32]), amount: ccd25 }),
        paid: false, refunded: false,
        invoice_by: Timestamp::from_timestamp_millis(1_795_117_380_000),
        accepted: true,
        date_proposal: Some(DateProposal { by: Side::Supplier, invoice_by: Timestamp::from_timestamp_millis(1_795_203_780_000), expires: Timestamp::from_timestamp_millis(1_795_722_180_000) }),
        recounts: 1,
        agent: ag, referee: acct("0101010101010101010101010101010101010101010101010101010101010101"),
        rep: Some(acct("0202020202020202020202020202020202020202020202020202020202020202")),
        funder: buyer, ruled_delivered: true,
        gate_met: true, gate_counted_at: Some(Timestamp::from_timestamp_millis(1_795_181_000_000)),
        referee_proposal: Some(RefereeProposal { by: Side::Buyer, referee: acct("0303030303030303030303030303030303030303030303030303030303030303"), expires: Timestamp::from_timestamp_millis(1_795_722_180_000) }),
    };
    let empty = Order {
        supplier: s, receiver: r, approver: None, expected_qty: 7, amount: Amount::from_micro_ccd(1),
        commits: vec![], reveals: vec![], invoice: None, supplier_approval: None, paid: true, refunded: false,
        invoice_by: Timestamp::from_timestamp_millis(1_795_117_380_000), accepted: false, date_proposal: None, recounts: 0,
        agent: ag, referee: acct("0101010101010101010101010101010101010101010101010101010101010101"), rep: None, funder: buyer, ruled_delivered: false,
        gate_met: false, gate_counted_at: None, referee_proposal: None,
    };
    let supplier = Supplier { payout: s, payout_set_at: Timestamp::from_timestamp_millis(1_795_117_380_000) };
    let decision = Event::Decision {
        order_id: 1, verdict: Verdict::Cleared, codes: vec![], agent: ag, agent_token_id: 1287,
        receipt_hash: HashSha2256([0xab; 32]), paid_to: Some(s), at: Timestamp::from_timestamp_millis(1_795_181_528_000), asked_by: s,
    };
    let held = Event::Decision {
        order_id: 1, verdict: Verdict::Held, codes: vec![Code::HeldNoSupplierApproval, Code::HeldPayoutCoolOff], agent: ag, agent_token_id: 1287,
        receipt_hash: HashSha2256([0xab; 32]), paid_to: None, at: Timestamp::from_timestamp_millis(1_795_181_528_000), asked_by: ag,
    };
    let config = ConfigView { admin: buyer, pending_admin: Some(ag), hold_ms: 60_000, registry: ContractAddress { index: 12802, subindex: 0 } };
    let got = [
        ("order_full", hx(concordium_std::to_bytes(&full))),
        ("order_empty", hx(concordium_std::to_bytes(&empty))),
        ("supplier", hx(concordium_std::to_bytes(&supplier))),
        ("config", hx(concordium_std::to_bytes(&config))),
        ("decision_cleared", hx(concordium_std::to_bytes(&decision))),
        ("decision_held", hx(concordium_std::to_bytes(&held))),
    ];
    let fixture = include_str!("../../test/fixtures/escrow-bytes.json");
    for (k, v) in &got {
        println!("\"{k}\": \"{v}\",");
    }
    for (k, v) in &got {
        assert!(fixture.contains(&format!("\"{k}\": \"{v}\"")), "fixture {k} is out of date");
    }
}

#[test]
fn an_individual_buyer_can_order_without_an_approver() {
    // One person buying for themselves: they count at the gate, the supplier's driver counts,
    // and both must agree. Nobody else can count.
    let mut t = setup();
    let solo = CreateOrderParams { approver: None, ..order_params(7) };
    t.call(ADMIN, "create_order", &solo, PRICE).expect("individual order");
    let o = t.ok(STRANGER, "view_order", &7u64).parse_return_value::<Order>().unwrap();
    assert_eq!(o.approver, None);
    t.ok(SUPPLIER, "accept_order", &AcceptParams { order_id: 7, invoice_by: DUE, rep: REP });
    let h = |who: AccountAddress, salt: [u8; 32]| HashSha2256(Sha256::digest(rules::commit_preimage(7, 0, &who.0, QTY, &salt)).into());
    assert_eq!(t.err(APPROVER, "commit_count", &CommitParams { order_id: 7, hash: h(APPROVER, [3; 32]) }), Error::NotOrderSigner);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: 7, hash: h(RECEIVER, [1; 32]) });
    t.ok(REP, "commit_count", &CommitParams { order_id: 7, hash: h(REP, [2; 32]) });
    t.ok(RECEIVER, "reveal_count", &RevealParams { order_id: 7, qty: QTY, salt: [1; 32] });
    t.ok(REP, "reveal_count", &RevealParams { order_id: 7, qty: QTY, salt: [2; 32] });
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: 7, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: 7, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    let r = t.ok(AGENT, "execute_payment", &ExecuteParams { order_id: 7, receipt_hash: RECEIPT });
    assert_eq!(t.decision(&r), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn a_recount_cannot_wipe_the_reps_count_into_a_refund() {
    // Audit 21 Nov H1: the rep unsealed, the receiver stayed silent, the buyer asked for a
    // recount (which clears the counts) and then waited out the date.
    let mut t = setup();
    let (sr, sa) = ([11u8; 32], [22u8; 32]);
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, sr) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, sa) });
    t.ok(REP, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sa });
    t.ok(ADMIN, "recount", &ORDER);
    assert!(t.order().reveals.is_empty());
    t.past_due();
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    // The referee still decides.
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Delivered });
}

#[test]
fn once_both_gate_counters_sealed_the_buyer_cannot_refund_alone() {
    // Audit 21 Nov H1: both sealed (the goods are at the gate), nobody unsealed, the buyer
    // recounts at once and its receiver never seals again.
    let mut t = setup();
    t.ok(RECEIVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(RECEIVER, QTY, [1; 32]) });
    t.ok(REP, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(REP, QTY, [2; 32]) });
    assert!(t.order().gate_met);
    t.ok(ADMIN, "recount", &ORDER);
    t.past_due();
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    let before = t.balance(ADMIN);
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund });
    assert_eq!(t.balance(ADMIN), before + PRICE);
}

#[test]
fn a_named_approver_gets_the_hold_period_after_the_gate_counts() {
    // Audit 21 Nov H2: the receiver and the driver cannot be paid before the approver counts.
    let mut t = setup();
    t.wait(HOLD_MS); // the supplier's payout hold is over
    happy_path_until_execute(&mut t, QTY, QTY);
    assert_eq!(execute(&mut t), (Verdict::Held, vec![Code::HeldApproverWindow], None));
    // The approver counts and agrees: the window ends at once.
    let sp = [33u8; 32];
    t.ok(APPROVER, "commit_count", &CommitParams { order_id: ORDER, hash: commit_hash(APPROVER, QTY, sp) });
    t.ok(APPROVER, "reveal_count", &RevealParams { order_id: ORDER, qty: QTY, salt: sp });
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
}

#[test]
fn a_silent_referee_can_be_replaced_only_by_both_sides() {
    // Audit 21 Nov M1.
    let mut t = setup();
    count(&mut t, QTY, QTY - 1);
    // Not a neutral party.
    for bad in [ADMIN, SUPPLIER, RECEIVER, APPROVER, AGENT, REP] {
        assert_eq!(t.err(SUPPLIER, "change_referee", &RefereeParams { order_id: ORDER, referee: bad }), Error::BadReferee);
    }
    assert_eq!(t.err(STRANGER, "change_referee", &RefereeParams { order_id: ORDER, referee: OTHER_SIGNER }), Error::NotOrderParty);
    // One side alone only proposes.
    t.ok(SUPPLIER, "change_referee", &RefereeParams { order_id: ORDER, referee: OTHER_SIGNER });
    assert_eq!(t.order().referee, REFEREE);
    // The supplier can withdraw its own proposal by proposing the current referee.
    t.ok(SUPPLIER, "change_referee", &RefereeParams { order_id: ORDER, referee: REFEREE });
    assert!(t.order().referee_proposal.is_none());
    t.ok(SUPPLIER, "change_referee", &RefereeParams { order_id: ORDER, referee: OTHER_SIGNER });
    // A different account from the buyer is a counter-proposal, not agreement.
    t.ok(ADMIN, "change_referee", &RefereeParams { order_id: ORDER, referee: STRANGER });
    assert_eq!(t.order().referee, REFEREE);
    t.ok(SUPPLIER, "change_referee", &RefereeParams { order_id: ORDER, referee: STRANGER });
    assert_eq!(t.order().referee, STRANGER);
    assert_eq!(t.err(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund }), Error::NotReferee);
    t.ok(STRANGER, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Refund });
}

#[test]
fn a_delivered_ruling_gives_the_supplier_time_to_invoice() {
    // Audit 21 Nov M2: the buyer cannot refund straight after a late "delivered" ruling.
    let mut t = setup();
    count(&mut t, QTY, QTY - 1);
    t.past_due();
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Delivered });
    assert_eq!(t.err(ADMIN, "refund", &ORDER), Error::RefundLocked);
    t.ok(AGENT, "submit_invoice", &InvoiceParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.ok(SUPPLIER, "approve_invoice", &ApproveParams { order_id: ORDER, invoice_hash: INVOICE, amount: PRICE });
    t.wait(HOLD_MS);
    assert_eq!(execute(&mut t), (Verdict::Cleared, vec![], Some(PAYOUT)));
    // If the supplier never invoices, the buyer can refund once the grace week is over.
    let mut t = setup();
    count(&mut t, QTY, QTY - 1);
    t.past_due();
    t.ok(REFEREE, "rule", &RuleParams { order_id: ORDER, ruling: Ruling::Delivered });
    t.wait(7 * 24 * 3600 * 1000 + 1);
    t.ok(ADMIN, "refund", &ORDER);
}

#[test]
fn the_buyers_counters_are_neither_the_supplier_nor_the_agent() {
    // Audit 21 Nov L3.
    let mut t = setup();
    t.ok(ADMIN, "add_signer", &SignerParams { account: SUPPLIER, role: Role::Receiver, person_tag: None, id_audit: None });
    t.ok(ADMIN, "add_signer", &SignerParams { account: AGENT, role: Role::Approver, person_tag: None, id_audit: None });
    let mut p = order_params(77);
    p.receiver = SUPPLIER;
    assert_eq!(t.call(ADMIN, "create_order", &p, PRICE).expect_err("supplier as receiver").parse_return_value::<Error>().unwrap(), Error::BadOrderSigners);
    let mut p = order_params(78);
    p.approver = Some(AGENT);
    assert_eq!(t.call(ADMIN, "create_order", &p, PRICE).expect_err("agent as approver").parse_return_value::<Error>().unwrap(), Error::BadOrderSigners);
}
