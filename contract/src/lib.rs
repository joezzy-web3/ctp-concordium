//! Clear to Pay escrow contract.
//!
//! The buyer escrows CCD for an order. Two people in two different roles
//! commit and then reveal a blind delivery count. A registered agent submits
//! the invoice and asks for payment. The contract runs the rules in
//! `rules.rs` and pays the supplier's payout account only on CLEARED; every
//! decision, paid or not, is logged by the contract as a `Decision` event.
//! See `../DESIGN.md`.
#![cfg_attr(target_arch = "wasm32", no_std)]

use concordium_std::*;
pub mod rules;
pub mod registry;
pub use rules::{Code, Role, Verdict};
use rules::{Facts, Reveal};

pub type OrderId = u64;

/// Allowed range for the payout hold: at least 1 minute, at most 30 days.
const MIN_HOLD_MS: u64 = 60 * 1000;
const MAX_HOLD_MS: u64 = 30 * 24 * 3600 * 1000;
/// How many times the buyer or supplier can ask the signers to count again.
pub const MAX_RECOUNTS: u8 = 2;
/// A proposed date change lapses after this long if the other side has not confirmed it.
const PROPOSAL_TTL_MS: u64 = 7 * 24 * 3600 * 1000;
/// After the referee rules the goods delivered, the supplier has at least this long to invoice.
const RULED_INVOICE_GRACE_MS: u64 = 7 * 24 * 3600 * 1000;

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Supplier {
    pub payout: AccountAddress,
    pub payout_set_at: Timestamp,
}

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub signer: AccountAddress,
    pub role: Role,
    pub hash: HashSha2256,
}

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct RevealedCount {
    pub signer: AccountAddress,
    pub role: Role,
    pub qty: u64,
}

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Invoice {
    pub agent: AccountAddress,
    pub agent_token_id: u64,
    pub invoice_hash: HashSha2256,
    pub amount: Amount,
}

/// What the supplier approved: this exact invoice, for this exact amount.
#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Approval {
    pub invoice_hash: HashSha2256,
    pub amount: Amount,
}

/// The two sides of an order. A date proposal belongs to a side, not to an account, so a
/// change of buyer admin cannot turn the buyer's own proposal into a confirmation.
#[derive(Serialize, SchemaType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Buyer,
    Supplier,
}

/// A new "invoice by" date proposed by one side, waiting for the other side to confirm.
/// It lapses at `expires`.
#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct DateProposal {
    pub by: Side,
    pub invoice_by: Timestamp,
    pub expires: Timestamp,
}

/// A referee's ruling on a disputed delivery.
/// A new referee proposed by one side, waiting for the other.
#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct RefereeProposal {
    pub by: Side,
    pub referee: AccountAddress,
    pub expires: Timestamp,
}

#[derive(Serialize, SchemaType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ruling {
    /// The goods were delivered: the delivery counts as confirmed.
    Delivered,
    /// They were not: the money goes back to whoever funded the order.
    Refund,
}

/// A listed signer: its role, and (once proven with Concordium ID) a salted fingerprint of
/// the person behind the account plus the hash of the anchored verification audit record.
#[derive(Serialize, SchemaType, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SignerInfo {
    pub role: Role,
    pub person_tag: Option<HashSha2256>,
    pub id_audit: Option<HashSha2256>,
}

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub supplier: AccountAddress,
    /// The buyer's counter at the gate.
    pub receiver: AccountAddress,
    /// An optional second buyer-side person who checks inside. A company names one as its check
    /// against an insider colluding with the driver; an individual buyer has none.
    pub approver: Option<AccountAddress>,
    pub expected_qty: u64,
    pub amount: Amount,
    pub commits: Vec<Commit>,
    pub reveals: Vec<RevealedCount>,
    pub invoice: Option<Invoice>,
    /// The invoice and amount the supplier approved from its own account.
    pub supplier_approval: Option<Approval>,
    pub paid: bool,
    pub refunded: bool,
    /// The agreed deadline: by this time delivery must be confirmed and an invoice approved.
    /// After it, no new counts or approvals are accepted (unless both sides move the date).
    pub invoice_by: Timestamp,
    /// The supplier accepted the order and its date from its own account (the PO acknowledgment).
    pub accepted: bool,
    /// A date change proposed by one side, waiting for the other.
    pub date_proposal: Option<DateProposal>,
    /// Recounts used so far (at most MAX_RECOUNTS).
    pub recounts: u8,
    /// The one registered agent that may put an invoice on this order.
    pub agent: AccountAddress,
    /// The neutral referee named on the order, seen by the supplier before it accepts.
    /// It settles a dispute once the supplier's delivery rep has counted.
    pub referee: AccountAddress,
    /// The supplier's delivery rep, named by the supplier when it accepts. It counts at the gate.
    pub rep: Option<AccountAddress>,
    /// The account that funded the order; refunds go back to it.
    pub funder: AccountAddress,
    /// The referee ruled that the goods were delivered.
    pub ruled_delivered: bool,
    /// Both gate counters sealed at least once. Stays true through recounts: from then on the
    /// supplier has a delivery on record, and only the referee can send the money back while
    /// the counts do not confirm it.
    pub gate_met: bool,
    /// When the receiver's and the rep's counts were both unsealed in this round. A named
    /// approver gets the hold period from then to unseal before payment can clear.
    pub gate_counted_at: Option<Timestamp>,
    /// A referee change proposed by one side, waiting for the other.
    pub referee_proposal: Option<RefereeProposal>,
}

#[derive(Serial, DeserialWithState)]
#[concordium(state_parameter = "S")]
pub struct State<S = StateApi> {
    admin: AccountAddress,
    /// An account the admin proposed as the new admin; it becomes admin when it accepts.
    pending_admin: Option<AccountAddress>,
    hold_ms: u64,
    /// The CIS-8004 Agent Registry asked about every agent, at registration and at every use.
    registry: ContractAddress,
    signers: StateMap<AccountAddress, SignerInfo, S>,
    /// Account that owns a registered agent -> its CIS-8004 agent token id.
    agents: StateMap<AccountAddress, u64, S>,
    suppliers: StateMap<AccountAddress, Supplier, S>,
    orders: StateMap<OrderId, Order, S>,
}

#[derive(Serialize, SchemaType, Debug, PartialEq, Eq, Reject)]
pub enum Error {
    #[from(ParseError)]
    Parse,
    LogFull,
    LogMalformed,
    NotAdmin,
    NotSigner,
    NotSupplier,
    NotAgent,
    UnknownOrder,
    OrderExists,
    UnknownSupplier,
    SupplierExists,
    OrderClosed,
    ZeroAmount,
    BadHold,
    /// The receiver and approver of an order must be two different, currently listed signers in those roles.
    BadOrderSigners,
    /// Only the receiver and approver named on the order can count it.
    NotOrderSigner,
    /// The signer was removed or changed role after the order was created.
    SignerNoLongerValid,
    AlreadyCommitted,
    NoInvoice,
    NotCommitted,
    AlreadyRevealed,
    /// Reveals open only after two people in two different roles have committed.
    WaitingForSecondRole,
    RevealDoesNotMatchCommit,
    InvoiceExists,
    TransferFailed,
    /// The registry does not show this agent as Active and owned by this account.
    AgentNotVerified,
    /// The registry could not be read, or answered in an unexpected format (fail closed).
    RegistryUnavailable,
    /// The agreed date has passed: no new counts, invoices or approvals.
    PastDeadline,
    /// The date must be in the future.
    BadDate,
    AlreadyAccepted,
    /// The supplier has not accepted this order yet.
    OrderNotAccepted,
    /// The supplier accepted the order and the money is locked for it: the buyer can take it
    /// back only after the agreed date if the order was not ready to pay, or if the supplier releases it.
    RefundLocked,
    /// The supplier approved this invoice and it matches the order: only the supplier can reject it.
    InvoiceApprovedBySupplier,
    /// A recount is only for two unsealed counts that do not confirm the delivery.
    RecountNotNeeded,
    NoRecountsLeft,
    /// Only the account proposed as the new admin can accept.
    NotPendingAdmin,
    /// Only the buyer or the supplier of this order can do this.
    NotOrderParty,
    /// To accept, confirm the order's current date (it may have changed).
    DateChanged,
    /// An order must be for at least one unit.
    ZeroQuantity,
    /// The referee must be someone other than the buyer, supplier, signers and agent.
    BadReferee,
    /// The delivery rep must be someone other than the buyer, its signers, the referee and the agent.
    BadRep,
    /// Only the referee named on the order can rule.
    NotReferee,
    /// A ruling is only for a delivery the supplier's rep counted that the counts do not confirm.
    NoDispute,
    /// Only the agent named on the order can submit its invoice.
    NotOrderAgent,
    /// The two signers on an order are proven to be the same person.
    SamePerson,
}

impl From<LogError> for Error {
    fn from(e: LogError) -> Self {
        match e {
            LogError::Full => Error::LogFull,
            LogError::Malformed => Error::LogMalformed,
        }
    }
}

impl From<TransferError> for Error {
    fn from(_: TransferError) -> Self { Error::TransferFailed }
}

pub type ContractResult<A> = Result<A, Error>;

/// Events. `Decision` is the on-chain accountability record.
#[derive(Serialize, SchemaType, Debug, PartialEq, Eq)]
pub enum Event {
    SupplierRegistered { supplier: AccountAddress, payout: AccountAddress, at: Timestamp },
    PayoutChanged { supplier: AccountAddress, payout: AccountAddress, at: Timestamp },
    OrderCreated { order_id: OrderId, supplier: AccountAddress, expected_qty: u64, amount: Amount, invoice_by: Timestamp, agent: AccountAddress, referee: AccountAddress },
    CountCommitted { order_id: OrderId, signer: AccountAddress, role: Role },
    CountRevealed { order_id: OrderId, signer: AccountAddress, role: Role, qty: u64 },
    InvoiceSubmitted { order_id: OrderId, agent: AccountAddress, agent_token_id: u64, invoice_hash: HashSha2256, amount: Amount },
    InvoiceApproved { order_id: OrderId, supplier: AccountAddress, invoice_hash: HashSha2256, amount: Amount },
    InvoiceRejected { order_id: OrderId, by: AccountAddress, invoice_hash: HashSha2256 },
    SignerSet { account: AccountAddress, role: Role, person_tag: Option<HashSha2256>, id_audit: Option<HashSha2256> },
    AgentSet { account: AccountAddress, agent_token_id: u64 },
    Decision {
        order_id: OrderId,
        verdict: Verdict,
        codes: Vec<Code>,
        agent: AccountAddress,
        agent_token_id: u64,
        receipt_hash: HashSha2256,
        paid_to: Option<AccountAddress>,
        at: Timestamp,
        /// Who asked for the decision: the agent, the supplier or the buyer.
        asked_by: AccountAddress,
    },
    Refunded { order_id: OrderId, amount: Amount, by: AccountAddress },
    OrderAccepted { order_id: OrderId, invoice_by: Timestamp, rep: AccountAddress },
    DateProposed { order_id: OrderId, by: AccountAddress, invoice_by: Timestamp },
    DateChanged { order_id: OrderId, invoice_by: Timestamp },
    RecountStarted { order_id: OrderId, recount: u8, by: AccountAddress },
    SignerRemoved { account: AccountAddress },
    AgentRemoved { account: AccountAddress },
    AdminProposed { account: AccountAddress },
    AdminChanged { from: AccountAddress, to: AccountAddress },
    Ruled { order_id: OrderId, ruling: Ruling, by: AccountAddress },
    DateProposalCleared { order_id: OrderId },
    RefereeProposed { order_id: OrderId, by: AccountAddress, referee: AccountAddress },
    RefereeChanged { order_id: OrderId, referee: AccountAddress },
}

// ---------- parameters ----------

#[derive(Serialize, SchemaType)]
pub struct InitParams {
    /// How long a new payout account waits before it can be paid (ms). 72 h in production.
    pub hold_ms: u64,
    /// The CIS-8004 Agent Registry (testnet: <12802,0>).
    pub registry: ContractAddress,
}

#[derive(Serialize, SchemaType)]
pub struct SignerParams {
    pub account: AccountAddress,
    pub role: Role,
    /// Salted fingerprint of the person, from a Concordium ID proof (docs/F01_SIGNER_IDENTITY.md).
    pub person_tag: Option<HashSha2256>,
    /// Hash of the anchored verification audit record for that proof.
    pub id_audit: Option<HashSha2256>,
}

#[derive(Serialize, SchemaType)]
pub struct AgentParams {
    pub account: AccountAddress,
    pub agent_token_id: u64,
}

#[derive(Serialize, SchemaType)]
pub struct SupplierParams {
    pub supplier: AccountAddress,
    pub payout: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct CreateOrderParams {
    pub order_id: OrderId,
    pub supplier: AccountAddress,
    pub expected_qty: u64,
    pub receiver: AccountAddress,
    /// Optional: companies name one, an individual buyer leaves it out.
    pub approver: Option<AccountAddress>,
    /// The proposed deadline for delivery and an approved invoice. The supplier agrees to it by accepting.
    pub invoice_by: Timestamp,
    /// The one registered agent that may submit this order's invoice.
    pub agent: AccountAddress,
    /// A neutral referee for delivery disputes, shown to the supplier before it accepts.
    pub referee: AccountAddress,
}

/// The supplier accepts the order at this exact date (so a last-moment change cannot slip in)
/// and names its delivery rep, who counts at the gate.
#[derive(Serialize, SchemaType)]
pub struct AcceptParams {
    pub order_id: OrderId,
    pub invoice_by: Timestamp,
    pub rep: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct RuleParams {
    pub order_id: OrderId,
    pub ruling: Ruling,
}

#[derive(Serialize, SchemaType)]
pub struct RefereeParams {
    pub order_id: OrderId,
    pub referee: AccountAddress,
}

#[derive(Serialize, SchemaType)]
pub struct DateParams {
    pub order_id: OrderId,
    pub invoice_by: Timestamp,
}

#[derive(Serialize, SchemaType)]
pub struct ApproveParams {
    pub order_id: OrderId,
    pub invoice_hash: HashSha2256,
    /// The amount the supplier agrees to be paid for this invoice.
    pub amount: Amount,
}

/// Sets up the cast in one transaction.
#[derive(Serialize, SchemaType)]
pub struct SetupParams {
    pub signers: Vec<SignerParams>,
    pub agents: Vec<AgentParams>,
    pub suppliers: Vec<SupplierParams>,
}

#[derive(Serialize, SchemaType)]
pub struct CommitParams {
    pub order_id: OrderId,
    pub hash: HashSha2256,
}

#[derive(Serialize, SchemaType)]
pub struct RevealParams {
    pub order_id: OrderId,
    pub qty: u64,
    pub salt: [u8; 32],
}

#[derive(Serialize, SchemaType)]
pub struct InvoiceParams {
    pub order_id: OrderId,
    pub invoice_hash: HashSha2256,
    pub amount: Amount,
}

#[derive(Serialize, SchemaType)]
pub struct ExecuteParams {
    pub order_id: OrderId,
    /// SHA-256 of the off-chain receipt for this decision (see ../receipt/).
    pub receipt_hash: HashSha2256,
}

#[derive(Serialize, SchemaType)]
pub struct ConfigView {
    pub admin: AccountAddress,
    pub pending_admin: Option<AccountAddress>,
    pub hold_ms: u64,
    pub registry: ContractAddress,
}

// ---------- helpers ----------

fn sender_account(ctx: &ReceiveContext) -> ContractResult<AccountAddress> {
    match ctx.sender() {
        Address::Account(a) => Ok(a),
        Address::Contract(_) => Err(Error::NotAdmin),
    }
}

fn ensure_admin(ctx: &ReceiveContext, host: &Host<State>) -> ContractResult<()> {
    ensure!(ctx.sender().matches_account(&host.state().admin), Error::NotAdmin);
    Ok(())
}

/// Asks the CIS-8004 registry whether `token_id` is Active and owned by `account`.
/// Any failure to read or parse the answer is a refusal (fail closed).
fn verify_agent(host: &Host<State>, token_id: u64, account: &AccountAddress) -> ContractResult<()> {
    let mut param = [0u8; 9];
    param[0] = 8;
    param[1..].copy_from_slice(&token_id.to_le_bytes());
    let registry = host.state().registry;
    let mut rv = match host.invoke_contract_raw_read_only(&registry, Parameter::new_unchecked(&param), EntrypointName::new_unchecked("agentOf"), Amount::zero()) {
        Ok(Some(rv)) => rv,
        Ok(None) => return Err(Error::RegistryUnavailable),
        Err(CallContractError::LogicReject { .. }) => return Err(Error::AgentNotVerified), // no such agent
        Err(_) => return Err(Error::RegistryUnavailable),
    };
    let mut bytes = Vec::new();
    bytes.resize(rv.size() as usize, 0u8);
    rv.read_exact(&mut bytes).map_err(|_| Error::RegistryUnavailable)?;
    let info = registry::parse_agent_of(&bytes).map_err(|_| Error::RegistryUnavailable)?.ok_or(Error::AgentNotVerified)?;
    ensure!(info.token_id == token_id && info.active && info.owner == account.0, Error::AgentNotVerified);
    Ok(())
}

fn open_order(host: &Host<State>, order_id: OrderId) -> ContractResult<Order> {
    let order = host.state().orders.get(&order_id).map(|o| o.clone()).ok_or(Error::UnknownOrder)?;
    ensure!(!order.refunded, Error::OrderClosed);
    Ok(order)
}

fn reveals_of(o: &Order) -> Vec<Reveal<AccountAddress>> {
    o.reveals.iter().map(|r| Reveal { signer: r.signer, role: r.role, qty: r.qty }).collect()
}

/// The receiver and the supplier's rep both unsealed the ordered quantity and any approver
/// count agrees (rules::delivery_confirmed), or the referee ruled the goods delivered.
fn delivery_confirmed(o: &Order) -> bool {
    o.ruled_delivered || rules::delivery_confirmed(&reveals_of(o), o.expected_qty)
}

/// Both gate counters (receiver and the supplier's rep) sealed at least once on this order.
fn delivery_on_record(o: &Order) -> bool {
    o.gate_met
}

/// The supplier has a delivery on record that the counts do not confirm: only the referee
/// settles it (or the supplier gives the money back).
fn disputed(o: &Order) -> bool {
    delivery_on_record(o) && !delivery_confirmed(o)
}

/// Both gate counters (the buyer's receiver and the supplier's rep) have sealed this round.
fn gate_sealed(o: &Order) -> bool {
    o.commits.iter().any(|c| c.role == Role::Receiver) && o.commits.iter().any(|c| c.role == Role::SupplierRep)
}

/// The supplier approved the submitted invoice, and it is for the full escrowed amount.
fn invoice_approved(o: &Order) -> bool {
    match (&o.invoice, &o.supplier_approval) {
        (Some(i), Some(a)) => a.invoice_hash == i.invoice_hash && a.amount == i.amount && i.amount == o.amount,
        _ => false,
    }
}

/// Everything the supplier must deliver is done; only the payout hold can still be pending.
fn ready_to_pay(o: &Order) -> bool { delivery_confirmed(o) && invoice_approved(o) }

fn before_deadline(ctx: &ReceiveContext, o: &Order) -> ContractResult<()> {
    ensure!(ctx.metadata().slot_time() <= o.invoice_by, Error::PastDeadline);
    Ok(())
}

/// Invoices and approvals: before the date, or any time once the referee ruled the goods delivered.
fn invoice_window(ctx: &ReceiveContext, o: &Order) -> ContractResult<()> {
    if o.ruled_delivered { Ok(()) } else { before_deadline(ctx, o) }
}

/// The buyer (admin) or the supplier of this order.
fn order_party(ctx: &ReceiveContext, host: &Host<State>, o: &Order) -> ContractResult<AccountAddress> {
    let who = sender_account(ctx).map_err(|_| Error::NotOrderParty)?;
    ensure!(who == host.state().admin || who == o.supplier, Error::NotOrderParty);
    Ok(who)
}

/// Returns the escrow to the account that funded the order, and closes the order.
fn close_and_refund(host: &mut Host<State>, logger: &mut Logger, order_id: OrderId, amount: Amount, by: AccountAddress) -> ContractResult<()> {
    let mut funder = None;
    if let Some(mut o) = host.state_mut().orders.get_mut(&order_id) {
        o.refunded = true;
        funder = Some(o.funder);
    }
    let to = funder.ok_or(Error::UnknownOrder)?;
    host.invoke_transfer(&to, amount)?;
    logger.log(&Event::Refunded { order_id, amount, by })?;
    Ok(())
}

// ---------- init ----------

#[init(contract = "ctp_escrow", parameter = "InitParams", event = "Event")]
fn init(ctx: &InitContext, state_builder: &mut StateBuilder) -> InitResult<State> {
    let p: InitParams = ctx.parameter_cursor().get()?;
    ensure!((MIN_HOLD_MS..=MAX_HOLD_MS).contains(&p.hold_ms), Reject::from(Error::BadHold));
    Ok(State {
        admin: ctx.init_origin(),
        pending_admin: None,
        hold_ms: p.hold_ms,
        registry: p.registry,
        signers: state_builder.new_map(),
        agents: state_builder.new_map(),
        suppliers: state_builder.new_map(),
        orders: state_builder.new_map(),
    })
}

// ---------- admin ----------

fn set_signer(host: &mut Host<State>, logger: &mut Logger, p: &SignerParams) -> ContractResult<()> {
    ensure!(p.role != Role::SupplierRep, Error::BadOrderSigners);
    let _ = host.state_mut().signers.insert(p.account, SignerInfo { role: p.role, person_tag: p.person_tag, id_audit: p.id_audit });
    logger.log(&Event::SignerSet { account: p.account, role: p.role, person_tag: p.person_tag, id_audit: p.id_audit })?;
    Ok(())
}

fn set_agent(host: &mut Host<State>, logger: &mut Logger, p: &AgentParams) -> ContractResult<()> {
    verify_agent(host, p.agent_token_id, &p.account)?;
    let _ = host.state_mut().agents.insert(p.account, p.agent_token_id);
    logger.log(&Event::AgentSet { account: p.account, agent_token_id: p.agent_token_id })?;
    Ok(())
}

fn add_supplier(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger, p: &SupplierParams) -> ContractResult<()> {
    ensure!(host.state().suppliers.get(&p.supplier).is_none(), Error::SupplierExists);
    let at = ctx.metadata().slot_time();
    let _ = host.state_mut().suppliers.insert(p.supplier, Supplier { payout: p.payout, payout_set_at: at });
    logger.log(&Event::SupplierRegistered { supplier: p.supplier, payout: p.payout, at })?;
    Ok(())
}

/// Sets up signers, agents and suppliers in one transaction.
#[receive(contract = "ctp_escrow", name = "setup", parameter = "SetupParams", error = "Error", mutable, enable_logger)]
fn setup(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: SetupParams = ctx.parameter_cursor().get()?;
    for s in &p.signers {
        set_signer(host, logger, s)?;
    }
    for a in &p.agents {
        set_agent(host, logger, a)?;
    }
    for s in &p.suppliers {
        // Running setup again leaves an existing supplier (and its hold) untouched.
        if host.state().suppliers.get(&s.supplier).is_some() {
            continue;
        }
        add_supplier(ctx, host, logger, s)?;
    }
    Ok(())
}

#[receive(contract = "ctp_escrow", name = "add_signer", parameter = "SignerParams", error = "Error", mutable, enable_logger)]
fn add_signer(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: SignerParams = ctx.parameter_cursor().get()?;
    set_signer(host, logger, &p)
}

#[receive(contract = "ctp_escrow", name = "remove_signer", parameter = "AccountAddress", error = "Error", mutable, enable_logger)]
fn remove_signer(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    host.state_mut().signers.remove(&a);
    logger.log(&Event::SignerRemoved { account: a })?;
    Ok(())
}

/// Registers an agent the buyer trusts to submit invoices. The off-chain badge gate
/// (../gate/) checks its Verified by Concordium badge before the admin adds it.
#[receive(contract = "ctp_escrow", name = "add_agent", parameter = "AgentParams", error = "Error", mutable, enable_logger)]
fn add_agent(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: AgentParams = ctx.parameter_cursor().get()?;
    set_agent(host, logger, &p)
}

#[receive(contract = "ctp_escrow", name = "remove_agent", parameter = "AccountAddress", error = "Error", mutable, enable_logger)]
fn remove_agent(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    host.state_mut().agents.remove(&a);
    logger.log(&Event::AgentRemoved { account: a })?;
    Ok(())
}

/// Step 1 of handing over the buyer admin: propose the new account. Proposing the
/// current admin cancels a pending proposal.
#[receive(contract = "ctp_escrow", name = "propose_admin", parameter = "AccountAddress", error = "Error", mutable, enable_logger)]
fn propose_admin(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    let pending = if a == host.state().admin { None } else { Some(a) };
    host.state_mut().pending_admin = pending;
    logger.log(&Event::AdminProposed { account: a })?;
    Ok(())
}

/// Step 2: the proposed account accepts and becomes the admin. A typo cannot lock anyone out.
#[receive(contract = "ctp_escrow", name = "accept_admin", error = "Error", mutable, enable_logger)]
fn accept_admin(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let who = sender_account(ctx).map_err(|_| Error::NotPendingAdmin)?;
    ensure!(host.state().pending_admin == Some(who), Error::NotPendingAdmin);
    let from = host.state().admin;
    host.state_mut().admin = who;
    host.state_mut().pending_admin = None;
    logger.log(&Event::AdminChanged { from, to: who })?;
    Ok(())
}

/// First registration of a supplier and its payout account. The hold starts now.
/// After this, only the supplier itself can change the payout account.
#[receive(contract = "ctp_escrow", name = "register_supplier", parameter = "SupplierParams", error = "Error", mutable, enable_logger)]
fn register_supplier(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: SupplierParams = ctx.parameter_cursor().get()?;
    add_supplier(ctx, host, logger, &p)
}

#[receive(contract = "ctp_escrow", name = "create_order", parameter = "CreateOrderParams", error = "Error", mutable, payable, enable_logger)]
fn create_order(ctx: &ReceiveContext, host: &mut Host<State>, amount: Amount, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: CreateOrderParams = ctx.parameter_cursor().get()?;
    ensure!(amount > Amount::zero(), Error::ZeroAmount);
    ensure!(host.state().suppliers.get(&p.supplier).is_some(), Error::UnknownSupplier);
    ensure!(host.state().orders.get(&p.order_id).is_none(), Error::OrderExists);
    ensure!(p.expected_qty > 0, Error::ZeroQuantity);
    let receiver = host.state().signers.get(&p.receiver).map(|r| *r).ok_or(Error::BadOrderSigners)?;
    ensure!(receiver.role == Role::Receiver, Error::BadOrderSigners);
    // The buyer's counters are neither the supplier nor the agent.
    ensure!(p.receiver != p.supplier && p.receiver != p.agent, Error::BadOrderSigners);
    if let Some(a) = p.approver {
        ensure!(a != p.receiver && a != p.supplier && a != p.agent, Error::BadOrderSigners);
        let approver = host.state().signers.get(&a).map(|r| *r).ok_or(Error::BadOrderSigners)?;
        ensure!(approver.role == Role::Approver, Error::BadOrderSigners);
        // Once both signers are proven with Concordium ID, they must be two different people.
        if let (Some(x), Some(y)) = (receiver.person_tag, approver.person_tag) {
            ensure!(x != y, Error::SamePerson);
        }
    }
    ensure!(host.state().agents.get(&p.agent).is_some(), Error::NotAgent);
    let admin = host.state().admin;
    ensure!(![admin, p.supplier, p.receiver, p.agent].contains(&p.referee) && p.approver != Some(p.referee), Error::BadReferee);
    ensure!(p.invoice_by > ctx.metadata().slot_time(), Error::BadDate);
    let funder = sender_account(ctx).map_err(|_| Error::NotAdmin)?;
    let _ = host.state_mut().orders.insert(p.order_id, Order {
        supplier: p.supplier,
        receiver: p.receiver,
        approver: p.approver,
        expected_qty: p.expected_qty,
        amount,
        commits: Vec::new(),
        reveals: Vec::new(),
        invoice: None,
        supplier_approval: None,
        paid: false,
        refunded: false,
        invoice_by: p.invoice_by,
        accepted: false,
        date_proposal: None,
        recounts: 0,
        agent: p.agent,
        referee: p.referee,
        rep: None,
        funder,
        ruled_delivered: false,
        gate_met: false,
        gate_counted_at: None,
        referee_proposal: None,
    });
    logger.log(&Event::OrderCreated { order_id: p.order_id, supplier: p.supplier, expected_qty: p.expected_qty, amount, invoice_by: p.invoice_by, agent: p.agent, referee: p.referee })?;
    Ok(())
}

/// The buyer takes the escrow back. Allowed while the supplier has not accepted the order, or
/// after the agreed date if the order was not ready to pay and its delivery is not in dispute.
/// While the supplier's rep has counted a delivery the counts do not confirm, only the referee
/// can send the money back (`rule`), so the buyer's own counters cannot stall a delivery into a
/// refund. A confirmed delivery whose invoice was not approved by the date can be refunded: the
/// date was agreed by both sides.
#[receive(contract = "ctp_escrow", name = "refund", parameter = "OrderId", error = "Error", mutable, enable_logger)]
fn refund(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    let order = open_order(host, order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let expired = ctx.metadata().slot_time() > order.invoice_by && !ready_to_pay(&order) && !disputed(&order);
    ensure!(!order.accepted || expired, Error::RefundLocked);
    let admin = host.state().admin;
    close_and_refund(host, logger, order_id, order.amount, admin)
}

/// The supplier gives the escrow back to the buyer, for example when it cancels.
#[receive(contract = "ctp_escrow", name = "release_to_buyer", parameter = "OrderId", error = "Error", mutable, enable_logger)]
fn release_to_buyer(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let supplier = sender_account(ctx).map_err(|_| Error::NotSupplier)?;
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    let order = open_order(host, order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.supplier == supplier, Error::NotSupplier);
    close_and_refund(host, logger, order_id, order.amount, supplier)
}

/// The supplier accepts the order and its date. This is the PO acknowledgment: from now on
/// the buyer cannot take the money back unless the date passes with the order not ready.
#[receive(contract = "ctp_escrow", name = "accept_order", parameter = "AcceptParams", error = "Error", mutable, enable_logger)]
fn accept_order(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let supplier = sender_account(ctx).map_err(|_| Error::NotSupplier)?;
    let p: AcceptParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.supplier == supplier, Error::NotSupplier);
    ensure!(!order.accepted, Error::AlreadyAccepted);
    ensure!(p.invoice_by == order.invoice_by, Error::DateChanged);
    before_deadline(ctx, &order)?;
    let admin = host.state().admin;
    ensure!(![admin, order.receiver, order.referee, order.agent].contains(&p.rep) && order.approver != Some(p.rep), Error::BadRep);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.accepted = true;
        o.date_proposal = None;
        o.rep = Some(p.rep);
    }
    logger.log(&Event::OrderAccepted { order_id: p.order_id, invoice_by: order.invoice_by, rep: p.rep })?;
    Ok(())
}

/// Changes the agreed date. Before the supplier accepts, the buyer sets it alone. After that,
/// one side proposes and the change applies only when the other side proposes the same date.
#[receive(contract = "ctp_escrow", name = "change_date", parameter = "DateParams", error = "Error", mutable, enable_logger)]
fn change_date(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let p: DateParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let by = order_party(ctx, host, &order)?;
    let side = if by == host.state().admin { Side::Buyer } else { Side::Supplier };
    let now = ctx.metadata().slot_time();
    // Proposing the current date withdraws your own pending proposal.
    if p.invoice_by == order.invoice_by {
        if matches!(&order.date_proposal, Some(d) if d.by == side) {
            if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
                o.date_proposal = None;
            }
            logger.log(&Event::DateProposalCleared { order_id: p.order_id })?;
        }
        return Ok(());
    }
    ensure!(p.invoice_by > now, Error::BadDate);
    let other_agreed = matches!(&order.date_proposal, Some(d) if d.by != side && d.invoice_by == p.invoice_by && now <= d.expires);
    let buyer_alone = !order.accepted && side == Side::Buyer;
    let mut o = host.state_mut().orders.get_mut(&p.order_id).ok_or(Error::UnknownOrder)?;
    if other_agreed || buyer_alone {
        o.invoice_by = p.invoice_by;
        o.date_proposal = None;
        drop(o);
        logger.log(&Event::DateChanged { order_id: p.order_id, invoice_by: p.invoice_by })?;
    } else {
        let expires = Timestamp::from_timestamp_millis(now.timestamp_millis().saturating_add(PROPOSAL_TTL_MS));
        o.date_proposal = Some(DateProposal { by: side, invoice_by: p.invoice_by, expires });
        drop(o);
        logger.log(&Event::DateProposed { order_id: p.order_id, by, invoice_by: p.invoice_by })?;
    }
    Ok(())
}

/// Either side proposes a new referee for the order; it changes once the other side proposes
/// the same account (before the supplier accepts, the buyer alone may change it). Proposing
/// the current referee withdraws your own pending proposal. A silent referee can therefore be
/// replaced, but never by one side alone once the supplier has accepted.
#[receive(contract = "ctp_escrow", name = "change_referee", parameter = "RefereeParams", error = "Error", mutable, enable_logger)]
fn change_referee(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let p: RefereeParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let by = order_party(ctx, host, &order)?;
    let admin = host.state().admin;
    let side = if by == admin { Side::Buyer } else { Side::Supplier };
    if p.referee == order.referee {
        if matches!(&order.referee_proposal, Some(r) if r.by == side) {
            if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
                o.referee_proposal = None;
            }
        }
        return Ok(());
    }
    ensure!(
        ![admin, order.supplier, order.receiver, order.agent].contains(&p.referee) && order.approver != Some(p.referee) && order.rep != Some(p.referee),
        Error::BadReferee
    );
    let now = ctx.metadata().slot_time();
    let other_agreed = matches!(&order.referee_proposal, Some(r) if r.by != side && r.referee == p.referee && now <= r.expires);
    let buyer_alone = !order.accepted && side == Side::Buyer;
    let mut o = host.state_mut().orders.get_mut(&p.order_id).ok_or(Error::UnknownOrder)?;
    if other_agreed || buyer_alone {
        o.referee = p.referee;
        o.referee_proposal = None;
        drop(o);
        logger.log(&Event::RefereeChanged { order_id: p.order_id, referee: p.referee })?;
    } else {
        let expires = Timestamp::from_timestamp_millis(now.timestamp_millis().saturating_add(PROPOSAL_TTL_MS));
        o.referee_proposal = Some(RefereeProposal { by: side, referee: p.referee, expires });
        drop(o);
        logger.log(&Event::RefereeProposed { order_id: p.order_id, by, referee: p.referee })?;
    }
    Ok(())
}

/// The buyer or the supplier asks everyone to count again, once both gate counts are sealed and
/// the delivery is not confirmed: an honest miscount, the rest delivered, or a lost seal key.
/// At most MAX_RECOUNTS times; every earlier count stays in the event history.
#[receive(contract = "ctp_escrow", name = "recount", parameter = "OrderId", error = "Error", mutable, enable_logger)]
fn recount(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    let order = open_order(host, order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let by = order_party(ctx, host, &order)?;
    before_deadline(ctx, &order)?;
    ensure!(gate_sealed(&order) && !delivery_confirmed(&order), Error::RecountNotNeeded);
    ensure!(order.recounts < MAX_RECOUNTS, Error::NoRecountsLeft);
    let recount = order.recounts + 1;
    if let Some(mut o) = host.state_mut().orders.get_mut(&order_id) {
        o.commits.clear();
        o.reveals.clear();
        o.gate_counted_at = None;
        o.recounts = recount;
    }
    logger.log(&Event::RecountStarted { order_id, recount, by })?;
    Ok(())
}

/// The order's referee settles a disputed delivery: the supplier's rep counted, but the counts
/// do not confirm it (a counter disagreed or stayed silent). Delivered: the delivery counts as
/// confirmed and the invoice can still be submitted and approved after the date. Refund: the
/// money goes back to whoever funded the order.
#[receive(contract = "ctp_escrow", name = "rule", parameter = "RuleParams", error = "Error", mutable, enable_logger)]
fn rule(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let by = sender_account(ctx).map_err(|_| Error::NotReferee)?;
    let p: RuleParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.referee == by, Error::NotReferee);
    ensure!(disputed(&order), Error::NoDispute);
    logger.log(&Event::Ruled { order_id: p.order_id, ruling: p.ruling, by })?;
    match p.ruling {
        Ruling::Delivered => {
            // The supplier gets at least RULED_INVOICE_GRACE_MS to invoice, so a ruling that
            // lands near or after the date cannot be undone by a refund.
            let now = ctx.metadata().slot_time();
            let floor = Timestamp::from_timestamp_millis(now.timestamp_millis().saturating_add(RULED_INVOICE_GRACE_MS));
            let invoice_by = if order.invoice_by < floor { floor } else { order.invoice_by };
            if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
                o.ruled_delivered = true;
                o.invoice_by = invoice_by;
                o.date_proposal = None;
            }
            if invoice_by != order.invoice_by {
                logger.log(&Event::DateChanged { order_id: p.order_id, invoice_by })?;
            }
            Ok(())
        }
        Ruling::Refund => close_and_refund(host, logger, p.order_id, order.amount, by),
    }
}

// ---------- supplier ----------

/// The supplier changes its own payout account. The hold restarts, so a hijacked
/// supplier account cannot redirect a payment that is due now.
#[receive(contract = "ctp_escrow", name = "set_payout", parameter = "AccountAddress", error = "Error", mutable, enable_logger)]
fn set_payout(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let supplier = sender_account(ctx).map_err(|_| Error::NotSupplier)?;
    let payout: AccountAddress = ctx.parameter_cursor().get()?;
    let at = ctx.metadata().slot_time();
    let mut s = host.state_mut().suppliers.get_mut(&supplier).ok_or(Error::NotSupplier)?;
    s.payout = payout;
    s.payout_set_at = at;
    drop(s);
    logger.log(&Event::PayoutChanged { supplier, payout, at })?;
    Ok(())
}

// ---------- signers: blind counts ----------

/// The role this account holds on the order. The counters are fixed per order: the buyer's
/// receiver and approver when it is created, the supplier's rep when it is accepted. Removing
/// a signer from the list later does not change an order already under way.
fn order_role(order: &Order, signer: &AccountAddress) -> ContractResult<Role> {
    if *signer == order.receiver {
        Ok(Role::Receiver)
    } else if order.approver == Some(*signer) {
        Ok(Role::Approver)
    } else if order.rep == Some(*signer) {
        Ok(Role::SupplierRep)
    } else {
        Err(Error::NotOrderSigner)
    }
}

#[receive(contract = "ctp_escrow", name = "commit_count", parameter = "CommitParams", error = "Error", mutable, enable_logger)]
fn commit_count(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let signer = sender_account(ctx).map_err(|_| Error::NotSigner)?;
    let p: CommitParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    before_deadline(ctx, &order)?;
    let role = order_role(&order, &signer)?;
    // A signer may replace their own seal (for example after losing its key) until anyone has
    // unsealed in this round; after that a seal is final.
    let resealing = order.commits.iter().any(|c| c.signer == signer);
    ensure!(!resealing || order.reveals.is_empty(), Error::AlreadyCommitted);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.commits.retain(|c| c.signer != signer);
        o.commits.push(Commit { signer, role, hash: p.hash });
        if gate_sealed(&o) {
            o.gate_met = true;
        }
    }
    logger.log(&Event::CountCommitted { order_id: p.order_id, signer, role })?;
    Ok(())
}

#[receive(contract = "ctp_escrow", name = "reveal_count", parameter = "RevealParams", error = "Error", mutable, enable_logger, crypto_primitives)]
fn reveal_count(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger, crypto_primitives: &CryptoPrimitives) -> ContractResult<()> {
    let signer = sender_account(ctx).map_err(|_| Error::NotSigner)?;
    let p: RevealParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    before_deadline(ctx, &order)?;
    let role = order_role(&order, &signer)?;
    let commit = order.commits.iter().find(|c| c.signer == signer).ok_or(Error::NotCommitted)?.clone();
    ensure!(order.reveals.iter().all(|r| r.signer != signer), Error::AlreadyRevealed);
    // Blind: nobody unseals until both gate counters (receiver and supplier's rep) have sealed.
    ensure!(gate_sealed(&order), Error::WaitingForSecondRole);
    let h = crypto_primitives.hash_sha2_256(&rules::commit_preimage(p.order_id, order.recounts, &signer.0, p.qty, &p.salt));
    ensure!(h == commit.hash, Error::RevealDoesNotMatchCommit);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.reveals.push(RevealedCount { signer, role, qty: p.qty });
        let both = o.reveals.iter().any(|r| r.role == Role::Receiver) && o.reveals.iter().any(|r| r.role == Role::SupplierRep);
        if both && o.gate_counted_at.is_none() {
            o.gate_counted_at = Some(ctx.metadata().slot_time());
        }
    }
    logger.log(&Event::CountRevealed { order_id: p.order_id, signer, role, qty: p.qty })?;
    Ok(())
}

// ---------- supplier: approve the invoice ----------

/// The supplier approves, from its own account, the exact invoice (by hash) and the amount
/// it agrees to be paid. Without this, an agent cannot get an invented invoice paid, and a
/// buyer cannot pay less than the supplier approved.
#[receive(contract = "ctp_escrow", name = "approve_invoice", parameter = "ApproveParams", error = "Error", mutable, enable_logger)]
fn approve_invoice(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let supplier = sender_account(ctx).map_err(|_| Error::NotSupplier)?;
    let p: ApproveParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.supplier == supplier, Error::NotSupplier);
    ensure!(order.accepted, Error::OrderNotAccepted);
    invoice_window(ctx, &order)?;
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.supplier_approval = Some(Approval { invoice_hash: p.invoice_hash, amount: p.amount });
    }
    logger.log(&Event::InvoiceApproved { order_id: p.order_id, supplier, invoice_hash: p.invoice_hash, amount: p.amount })?;
    Ok(())
}

/// The buyer or the supplier clears a wrong invoice, so the right one can be submitted.
/// Without this, a compromised agent could jam an order with a junk invoice.
#[receive(contract = "ctp_escrow", name = "reject_invoice", parameter = "OrderId", error = "Error", mutable, enable_logger)]
fn reject_invoice(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let by = sender_account(ctx).map_err(|_| Error::NotAdmin)?;
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    let order = open_order(host, order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(by == host.state().admin || by == order.supplier, Error::NotAdmin);
    // The buyer cannot throw out an invoice the supplier approved for the full amount.
    ensure!(by == order.supplier || !invoice_approved(&order), Error::InvoiceApprovedBySupplier);
    let invoice = order.invoice.ok_or(Error::NoInvoice)?;
    if let Some(mut o) = host.state_mut().orders.get_mut(&order_id) {
        o.invoice = None;
        o.supplier_approval = None;
    }
    logger.log(&Event::InvoiceRejected { order_id, by, invoice_hash: invoice.invoice_hash })?;
    Ok(())
}

// ---------- agent ----------

#[receive(contract = "ctp_escrow", name = "submit_invoice", parameter = "InvoiceParams", error = "Error", mutable, enable_logger)]
fn submit_invoice(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let agent = sender_account(ctx).map_err(|_| Error::NotAgent)?;
    let agent_token_id = host.state().agents.get(&agent).map(|t| *t).ok_or(Error::NotAgent)?;
    verify_agent(host, agent_token_id, &agent)?;
    let p: InvoiceParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.agent == agent, Error::NotOrderAgent);
    ensure!(order.invoice.is_none(), Error::InvoiceExists);
    invoice_window(ctx, &order)?;
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.invoice = Some(Invoice { agent, agent_token_id, invoice_hash: p.invoice_hash, amount: p.amount });
    }
    logger.log(&Event::InvoiceSubmitted { order_id: p.order_id, agent, agent_token_id, invoice_hash: p.invoice_hash, amount: p.amount })?;
    Ok(())
}

/// Runs every rule. Pays the supplier's payout account only on CLEARED.
/// HELD and SEIZED pay nothing but still succeed, so the decision is recorded.
#[receive(contract = "ctp_escrow", name = "execute_payment", parameter = "ExecuteParams", error = "Error", return_value = "Verdict", mutable, enable_logger)]
fn execute_payment(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<Verdict> {
    let caller = sender_account(ctx).map_err(|_| Error::NotAgent)?;
    let p: ExecuteParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    // A paid order is final: no further decisions are logged for it.
    ensure!(!order.paid, Error::OrderClosed);
    let invoice = order.invoice.clone().ok_or(Error::NoInvoice)?;
    if caller == invoice.agent {
        // The agent that submitted the invoice: still registered here, and re-checked in the
        // registry at every decision, so a revoked or transferred agent is refused at once.
        let token = host.state().agents.get(&caller).map(|t| *t).ok_or(Error::NotAgent)?;
        ensure!(token == invoice.agent_token_id, Error::NotAgent);
        verify_agent(host, token, &caller)?;
    } else {
        // The supplier or the buyer can ask too, so payment never stalls on an offline agent.
        // The rules below are the same whoever asks.
        ensure!(caller == order.supplier || caller == host.state().admin, Error::NotAgent);
    }
    let supplier = host.state().suppliers.get(&order.supplier).map(|s| s.clone()).ok_or(Error::UnknownSupplier)?;
    let now = ctx.metadata().slot_time();
    let reveals = reveals_of(&order);
    let facts = Facts {
        paid: order.paid,
        expected_qty: order.expected_qty,
        order_amount: order.amount.micro_ccd,
        invoice_amount: Some(invoice.amount.micro_ccd),
        supplier_approved: order.supplier_approval == Some(Approval { invoice_hash: invoice.invoice_hash, amount: invoice.amount }),
        reveals: &reveals,
        ruled_delivered: order.ruled_delivered,
        approver_named: order.approver.is_some(),
        gate_counted_at: order.gate_counted_at.map(|t| t.timestamp_millis()),
        payout_set_at: supplier.payout_set_at.timestamp_millis(),
        now: now.timestamp_millis(),
        hold_ms: host.state().hold_ms,
    };
    let (verdict, codes) = rules::decide(&facts);
    let mut paid_to = None;
    if verdict == Verdict::Cleared {
        // Mark paid before the transfer, so the order can never be paid twice.
        if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
            o.paid = true;
        }
        host.invoke_transfer(&supplier.payout, order.amount)?;
        paid_to = Some(supplier.payout);
    }
    logger.log(&Event::Decision {
        order_id: p.order_id,
        verdict,
        codes,
        agent: invoice.agent,
        agent_token_id: invoice.agent_token_id,
        receipt_hash: p.receipt_hash,
        paid_to,
        at: now,
        asked_by: caller,
    })?;
    Ok(verdict)
}

// ---------- views ----------

#[receive(contract = "ctp_escrow", name = "view_order", parameter = "OrderId", error = "Error", return_value = "Order")]
fn view_order(ctx: &ReceiveContext, host: &Host<State>) -> ContractResult<Order> {
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    host.state().orders.get(&order_id).map(|o| o.clone()).ok_or(Error::UnknownOrder)
}

#[receive(contract = "ctp_escrow", name = "view_supplier", parameter = "AccountAddress", error = "Error", return_value = "Supplier")]
fn view_supplier(ctx: &ReceiveContext, host: &Host<State>) -> ContractResult<Supplier> {
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    host.state().suppliers.get(&a).map(|s| s.clone()).ok_or(Error::UnknownSupplier)
}

#[receive(contract = "ctp_escrow", name = "view_config", return_value = "ConfigView")]
fn view_config(_ctx: &ReceiveContext, host: &Host<State>) -> ReceiveResult<ConfigView> {
    Ok(ConfigView { admin: host.state().admin, pending_admin: host.state().pending_admin, hold_ms: host.state().hold_ms, registry: host.state().registry })
}
