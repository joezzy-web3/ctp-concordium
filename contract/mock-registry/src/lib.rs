//! Test-only stand-in for the CIS-8004 Agent Registry. It answers `agentOf` with an
//! AgentView laid out as the specification says (built by the escrow's own
//! `registry::build_agent_view`, so both sides share one definition), and lets a test
//! revoke an agent or change its owner. Never deployed.
#![cfg_attr(target_arch = "wasm32", no_std)]
use concordium_std::*;

#[allow(dead_code)]
#[path = "../../src/registry.rs"]
mod registry;

#[derive(Serialize, SchemaType, Clone, Copy)]
pub struct Entry {
    pub token_id: u64,
    pub owner: AccountAddress,
    pub active: bool,
}

#[derive(Serial, DeserialWithState)]
#[concordium(state_parameter = "S")]
pub struct State<S = StateApi> {
    agents: StateMap<u64, Entry, S>,
}

struct Raw(Vec<u8>);
impl Serial for Raw {
    fn serial<W: Write>(&self, out: &mut W) -> Result<(), W::Err> { out.write_all(&self.0) }
}

#[init(contract = "CIS-8004", parameter = "Vec<Entry>")]
fn init(ctx: &InitContext, sb: &mut StateBuilder) -> InitResult<State> {
    let list: Vec<Entry> = ctx.parameter_cursor().get()?;
    let mut agents = sb.new_map();
    for e in list {
        let _ = agents.insert(e.token_id, e);
    }
    Ok(State { agents })
}

#[receive(contract = "CIS-8004", name = "agentOf")]
fn agent_of(ctx: &ReceiveContext, host: &Host<State>) -> ReceiveResult<Raw> {
    let mut c = ctx.parameter_cursor();
    let tag: u8 = c.get()?;
    ensure_eq!(tag, 8u8);
    let id: u64 = c.get()?;
    let e = host.state().agents.get(&id).map(|e| *e).ok_or(Reject::default())?;
    Ok(Raw(registry::build_agent_view(e.token_id, e.owner.0, e.active, true)))
}

#[receive(contract = "CIS-8004", name = "set", parameter = "Entry", mutable)]
fn set(ctx: &ReceiveContext, host: &mut Host<State>) -> ReceiveResult<()> {
    let e: Entry = ctx.parameter_cursor().get()?;
    let _ = host.state_mut().agents.insert(e.token_id, e);
    Ok(())
}
