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
pub use rules::{Code, Role, Verdict};
use rules::{Facts, Reveal};

pub type OrderId = u64;

/// At most this many signers can commit a count for one order.
const MAX_COMMITS: usize = 8;

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

#[derive(Serialize, SchemaType, Clone, Debug, PartialEq, Eq)]
pub struct Order {
    pub supplier: AccountAddress,
    pub expected_qty: u64,
    pub amount: Amount,
    pub commits: Vec<Commit>,
    pub reveals: Vec<RevealedCount>,
    pub invoice: Option<Invoice>,
    pub paid: bool,
    pub refunded: bool,
}

#[derive(Serial, DeserialWithState)]
#[concordium(state_parameter = "S")]
pub struct State<S = StateApi> {
    admin: AccountAddress,
    hold_ms: u64,
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
    AlreadyCommitted,
    TooManyCommits,
    NotCommitted,
    AlreadyRevealed,
    /// Reveals open only after two people in two different roles have committed.
    WaitingForSecondRole,
    RevealDoesNotMatchCommit,
    InvoiceExists,
    TransferFailed,
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

fn open_order(host: &Host<State>, order_id: OrderId) -> ContractResult<Order> {
    let order = host.state().orders.get(&order_id).map(|o| o.clone()).ok_or(Error::UnknownOrder)?;
    ensure!(!order.refunded, Error::OrderClosed);
    Ok(order)
}

// ---------- init ----------

#[init(contract = "ctp_escrow", parameter = "InitParams", event = "Event")]
fn init(ctx: &InitContext, state_builder: &mut StateBuilder) -> InitResult<State> {
    let p: InitParams = ctx.parameter_cursor().get()?;
    Ok(State {
        admin: ctx.init_origin(),
        hold_ms: p.hold_ms,
        signers: state_builder.new_map(),
        agents: state_builder.new_map(),
        suppliers: state_builder.new_map(),
        orders: state_builder.new_map(),
    })
}

// ---------- admin ----------

#[receive(contract = "ctp_escrow", name = "add_signer", parameter = "SignerParams", error = "Error", mutable)]
fn add_signer(ctx: &ReceiveContext, host: &mut Host<State>) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: SignerParams = ctx.parameter_cursor().get()?;
    let _ = host.state_mut().signers.insert(p.account, p.role);
    Ok(())
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
#[receive(contract = "ctp_escrow", name = "add_agent", parameter = "AgentParams", error = "Error", mutable)]
fn add_agent(ctx: &ReceiveContext, host: &mut Host<State>) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: AgentParams = ctx.parameter_cursor().get()?;
    let _ = host.state_mut().agents.insert(p.account, p.agent_token_id);
    Ok(())
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
    ensure!(host.state().suppliers.get(&p.supplier).is_none(), Error::SupplierExists);
    let at = ctx.metadata().slot_time();
    let _ = host.state_mut().suppliers.insert(p.supplier, Supplier { payout: p.payout, payout_set_at: at });
    logger.log(&Event::SupplierRegistered { supplier: p.supplier, payout: p.payout, at })?;
    Ok(())
}

#[receive(contract = "ctp_escrow", name = "create_order", parameter = "CreateOrderParams", error = "Error", mutable, payable, enable_logger)]
fn create_order(ctx: &ReceiveContext, host: &mut Host<State>, amount: Amount, logger: &mut Logger) -> ContractResult<()> {
    ensure_admin(ctx, host)?;
    let p: CreateOrderParams = ctx.parameter_cursor().get()?;
    ensure!(amount > Amount::zero(), Error::ZeroAmount);
    ensure!(host.state().suppliers.get(&p.supplier).is_some(), Error::UnknownSupplier);
    ensure!(host.state().orders.get(&p.order_id).is_none(), Error::OrderExists);
    let _ = host.state_mut().orders.insert(p.order_id, Order {
        supplier: p.supplier,
        expected_qty: p.expected_qty,
        amount,
        commits: Vec::new(),
        reveals: Vec::new(),
        invoice: None,
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

#[receive(contract = "ctp_escrow", name = "commit_count", parameter = "CommitParams", error = "Error", mutable, enable_logger)]
fn commit_count(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let signer = sender_account(ctx).map_err(|_| Error::NotSigner)?;
    let role = host.state().signers.get(&signer).map(|r| *r).ok_or(Error::NotSigner)?;
    let p: CommitParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    ensure!(!order.paid, Error::OrderClosed);
    ensure!(order.commits.iter().all(|c| c.signer != signer), Error::AlreadyCommitted);
    ensure!(order.commits.len() < MAX_COMMITS, Error::TooManyCommits);
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
    let commit = order.commits.iter().find(|c| c.signer == signer).ok_or(Error::NotCommitted)?.clone();
    ensure!(order.reveals.iter().all(|r| r.signer != signer), Error::AlreadyRevealed);
    // Blind: nobody reveals until two different people in two different roles have committed.
    let two_roles = order.commits.iter().any(|a| order.commits.iter().any(|b| a.signer != b.signer && a.role != b.role));
    ensure!(two_roles, Error::WaitingForSecondRole);
    let h = crypto_primitives.hash_sha2_256(&rules::commit_preimage(p.order_id, p.qty, &p.salt));
    ensure!(h == commit.hash, Error::RevealDoesNotMatchCommit);
    if let Some(mut o) = host.state_mut().orders.get_mut(&p.order_id) {
        o.reveals.push(RevealedCount { signer, role: commit.role, qty: p.qty });
    }
    logger.log(&Event::CountRevealed { order_id: p.order_id, signer, role: commit.role, qty: p.qty })?;
    Ok(())
}

// ---------- agent ----------

#[receive(contract = "ctp_escrow", name = "submit_invoice", parameter = "InvoiceParams", error = "Error", mutable, enable_logger)]
fn submit_invoice(ctx: &ReceiveContext, host: &mut Host<State>, logger: &mut Logger) -> ContractResult<()> {
    let agent = sender_account(ctx).map_err(|_| Error::NotAgent)?;
    let agent_token_id = host.state().agents.get(&agent).map(|t| *t).ok_or(Error::NotAgent)?;
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
    let p: ExecuteParams = ctx.parameter_cursor().get()?;
    let order = open_order(host, p.order_id)?;
    if let Some(inv) = &order.invoice {
        ensure!(inv.agent == caller, Error::NotAgent);
    }
    let supplier = host.state().suppliers.get(&order.supplier).map(|s| s.clone()).ok_or(Error::UnknownSupplier)?;
    let now = ctx.metadata().slot_time();
    let reveals: Vec<Reveal<AccountAddress>> = order.reveals.iter().map(|r| Reveal { signer: r.signer, role: r.role, qty: r.qty }).collect();
    let facts = Facts {
        paid: order.paid,
        expected_qty: order.expected_qty,
        order_amount: order.amount.micro_ccd,
        invoice_amount: order.invoice.as_ref().map(|i| i.amount.micro_ccd),
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
    Ok(ConfigView { admin: host.state().admin, hold_ms: host.state().hold_ms })
}
