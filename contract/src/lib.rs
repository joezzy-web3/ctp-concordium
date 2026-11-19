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

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub supplier: AccountAddress,
    /// The two people named for this order. Only they can count it.
    pub receiver: AccountAddress,
    pub approver: AccountAddress,
    pub expected_qty: u64,
    pub amount: Amount,
    pub commits: Vec<Commit>,
    pub reveals: Vec<RevealedCount>,
    pub invoice: Option<Invoice>,
    /// The invoice and amount the supplier approved from its own account.
    pub supplier_approval: Option<Approval>,
    pub paid: bool,
    pub refunded: bool,
}

#[derive(Serial, DeserialWithState)]
#[concordium(state_parameter = "S")]
pub struct State<S = StateApi> {
    admin: AccountAddress,
    hold_ms: u64,
    /// The CIS-8004 Agent Registry asked about every agent, at registration and at every use.
    registry: ContractAddress,
    signers: StateMap<AccountAddress, Role, S>,
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
    OrderCreated { order_id: OrderId, supplier: AccountAddress, expected_qty: u64, amount: Amount },
    CountCommitted { order_id: OrderId, signer: AccountAddress, role: Role },
    CountRevealed { order_id: OrderId, signer: AccountAddress, role: Role, qty: u64 },
    InvoiceSubmitted { order_id: OrderId, agent: AccountAddress, agent_token_id: u64, invoice_hash: HashSha2256, amount: Amount },
    InvoiceApproved { order_id: OrderId, supplier: AccountAddress, invoice_hash: HashSha2256, amount: Amount },
    InvoiceRejected { order_id: OrderId, by: AccountAddress, invoice_hash: HashSha2256 },
    SignerSet { account: AccountAddress, role: Role },
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
    },
    Refunded { order_id: OrderId, amount: Amount },
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
    pub approver: AccountAddress,
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

// ---------- init ----------

#[init(contract = "ctp_escrow", parameter = "InitParams", event = "Event")]
fn init(ctx: &InitContext, state_builder: &mut StateBuilder) -> InitResult<State> {
    let p: InitParams = ctx.parameter_cursor().get()?;
    ensure!((MIN_HOLD_MS..=MAX_HOLD_MS).contains(&p.hold_ms), Reject::from(Error::BadHold));
    Ok(State {
        admin: ctx.init_origin(),
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
    let _ = host.state_mut().signers.insert(p.account, p.role);
    logger.log(&Event::SignerSet { account: p.account, role: p.role })?;
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

#[receive(contract = "ctp_escrow", name = "remove_signer", parameter = "AccountAddress", error = "Error", mutable)]
fn remove_signer(ctx: &ReceiveContext, host: &mut Host<State>) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    host.state_mut().signers.remove(&a);
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

#[receive(contract = "ctp_escrow", name = "remove_agent", parameter = "AccountAddress", error = "Error", mutable)]
fn remove_agent(ctx: &ReceiveContext, host: &mut Host<State>) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let a: AccountAddress = ctx.parameter_cursor().get()?;
    host.state_mut().agents.remove(&a);
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
    ensure!(p.receiver != p.approver, Error::BadOrderSigners);
    ensure!(host.state().signers.get(&p.receiver).map(|r| *r) == Some(Role::Receiver), Error::BadOrderSigners);
    ensure!(host.state().signers.get(&p.approver).map(|r| *r) == Some(Role::Approver), Error::BadOrderSigners);
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
    });
    logger.log(&Event::OrderCreated { order_id: p.order_id, supplier: p.supplier, expected_qty: p.expected_qty, amount })?;
    Ok(())
}

/// Returns the escrow of an unpaid order to the admin.
#[receive(contract = "ctp_escrow", name = "refund", parameter = "OrderId", error = "Error", mutable, enable_logger)]
fn refund(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let order_id: OrderId = ctx.parameter_cursor().get()?;
    let order = open_order(host, order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let admin = host.state().admin;
    if let Some(mut o) = host.state_mut().orders.get_mut(&order_id) {
        o.refunded = true;
    }
    host.invoke_transfer(&admin, order.amount)?;
    logger.log(&Event::Refunded { order_id, amount: order.amount })?;
    Ok(())
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

/// The role this account holds on the order, if it is the named receiver or approver
/// AND is still listed as a signer in that same role today.
fn order_role(host: &Host<State>, order: &Order, signer: &AccountAddress) -> ContractResult<Role> {
    let role = if *signer == order.receiver {
        Role::Receiver
    } else if *signer == order.approver {
        Role::Approver
    } else {
        return Err(Error::NotOrderSigner);
    };
    ensure!(host.state().signers.get(signer).map(|r| *r) == Some(role), Error::SignerNoLongerValid);
    Ok(role)
}

#[receive(contract = "ctp_escrow", name = "commit_count", parameter = "CommitParams", error = "Error", mutable, enable_logger)]
fn commit_count(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let signer = sender_account(ctx).map_err(|_| Error::NotSigner)?;
    let p: CommitParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    let role = order_role(host, &order, &signer)?;
    ensure!(order.commits.iter().all(|c| c.signer != signer), Error::AlreadyCommitted);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.commits.push(Commit { signer, role, hash: p.hash });
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
    // Re-checked at reveal time: a signer removed after committing can no longer count.
    let role = order_role(host, &order, &signer)?;
    let commit = order.commits.iter().find(|c| c.signer == signer).ok_or(Error::NotCommitted)?.clone();
    ensure!(order.reveals.iter().all(|r| r.signer != signer), Error::AlreadyRevealed);
    // Blind: nobody reveals until both named people have committed.
    ensure!(order.commits.len() == 2, Error::WaitingForSecondRole);
    let h = crypto_primitives.hash_sha2_256(&rules::commit_preimage(p.order_id, p.qty, &p.salt));
    ensure!(h == commit.hash, Error::RevealDoesNotMatchCommit);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.reveals.push(RevealedCount { signer, role, qty: p.qty });
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
    ensure!(order.invoice.is_none(), Error::InvoiceExists);
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
    let caller_token = host.state().agents.get(&caller).map(|t| *t).ok_or(Error::NotAgent)?;
    // Re-checked at every decision: a revoked or transferred agent is refused at once.
    verify_agent(host, caller_token, &caller)?;
    let p: ExecuteParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    // A paid order is final: no further decisions are logged for it.
    ensure!(!order.paid, Error::OrderClosed);
    // Only the agent that submitted the invoice, and is still registered, can ask for a decision.
    let invoice = order.invoice.clone().ok_or(Error::NoInvoice)?;
    ensure!(invoice.agent == caller, Error::NotAgent);
    let supplier = host.state().suppliers.get(&order.supplier).map(|s| s.clone()).ok_or(Error::UnknownSupplier)?;
    let now = ctx.metadata().slot_time();
    let reveals: Vec<Reveal<AccountAddress>> = order.reveals.iter().map(|r| Reveal { signer: r.signer, role: r.role, qty: r.qty }).collect();
    let facts = Facts {
        paid: order.paid,
        expected_qty: order.expected_qty,
        order_amount: order.amount.micro_ccd,
        invoice_amount: Some(invoice.amount.micro_ccd),
        supplier_approved: order.supplier_approval == Some(Approval { invoice_hash: invoice.invoice_hash, amount: invoice.amount }),
        reveals: &reveals,
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
        agent: caller,
        agent_token_id: caller_token,
        receipt_hash: p.receipt_hash,
        paid_to,
        at: now,
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
    Ok(ConfigView { admin: host.state().admin, hold_ms: host.state().hold_ms, registry: host.state().registry })
}
