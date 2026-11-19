//! Reads the CIS-8004 Agent Registry's `agentOf` answer (an `AgentView`).
//!
//! Layout from the CIS-8004 specification:
//!   token_id: AgentTokenId (0x08 + 8 bytes LE) | owner_account: 32 bytes
//!   agent_uri: OptionalString | metadata_hash: OptionalHash256
//!   external_reference: OptionalExtRef | agent_wallet: OptionalAddress
//!   status: Byte (0 Active, 1 Revoked) | registered_at: Timestamp (8)
//!   revoked_at: OptionalTimestamp | revocation_reason: OptionalString
//! Strings and byte strings carry a 4-byte little-endian length.
//!
//! The deployed testnet registry <12802,0> differs from the written spec in two ways,
//! found by reading its real answer for Agent #1287 (test `real_answer_for_agent_1287`):
//!   - the AgentView is wrapped in an Option: 0x00 = no such agent, 0x01 = AgentView follows;
//!   - after revocation_reason comes a metadata list: a 4-byte count, then (key, value) pairs,
//!     each with a 4-byte length.
//! The parser is strict: any byte it does not expect, or any leftover byte, is an
//! error, and the escrow then treats the agent as not verified (fail closed).

/// What the escrow needs from the registry.
#[derive(Debug, PartialEq, Eq)]
pub struct AgentInfo {
    pub token_id: u64,
    pub owner: [u8; 32],
    pub active: bool,
}

struct R<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> R<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], ()> {
        let end = self.i.checked_add(n).ok_or(())?;
        let s = self.b.get(self.i..end).ok_or(())?;
        self.i = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, ()> { Ok(self.take(1)?[0]) }
    fn u32(&mut self) -> Result<u32, ()> { let s = self.take(4)?; Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]])) }
    fn u64(&mut self) -> Result<u64, ()> {
        let s = self.take(8)?;
        let mut a = [0u8; 8];
        a.copy_from_slice(s);
        Ok(u64::from_le_bytes(a))
    }
    fn bytes(&mut self) -> Result<(), ()> { let n = self.u32()? as usize; self.take(n).map(|_| ()) }
    fn option(&mut self) -> Result<bool, ()> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(()),
        }
    }
}

/// Parses the registry's answer. Ok(None) means the registry knows no such agent.
pub fn parse_agent_of(b: &[u8]) -> Result<Option<AgentInfo>, ()> {
    let mut r = R { b, i: 0 };
    if !r.option()? {
        return if r.i == b.len() { Ok(None) } else { Err(()) };
    }
    let info = parse_view(&mut r)?;
    if r.i != b.len() {
        return Err(());
    }
    Ok(Some(info))
}

fn parse_view(r: &mut R) -> Result<AgentInfo, ()> {
    if r.u8()? != 8 {
        return Err(());
    }
    let token_id = r.u64()?;
    let mut owner = [0u8; 32];
    owner.copy_from_slice(r.take(32)?);
    if r.option()? { r.bytes()?; } // agent_uri
    if r.option()? { r.take(32)?; } // metadata_hash
    if r.option()? {
        // external_reference: contract address, kind tag (0 = Cis8), ExternalKeyId
        r.take(16)?;
        if r.u8()? != 0 {
            return Err(());
        }
        r.bytes()?; // namespace
        r.bytes()?; // key_type
        r.bytes()?; // public_key
    }
    if r.option()? { r.take(32)?; } // agent_wallet
    let active = match r.u8()? {
        0 => true,
        1 => false,
        _ => return Err(()),
    };
    r.u64()?; // registered_at
    if r.option()? { r.u64()?; } // revoked_at
    if r.option()? { r.bytes()?; } // revocation_reason
    let n = r.u32()?; // metadata entries
    if n > 64 {
        return Err(());
    }
    for _ in 0..n {
        r.bytes()?; // key
        r.bytes()?; // value
    }
    Ok(AgentInfo { token_id, owner, active })
}

/// Builds an AgentView exactly as the specification lays it out (used by tests and the mock registry).
#[cfg(any(test, feature = "mock"))]
pub fn build_agent_view(token_id: u64, owner: [u8; 32], active: bool, with_extras: bool) -> concordium_std::Vec<u8> {
    let mut v = concordium_std::Vec::new();
    let s = |v: &mut concordium_std::Vec<u8>, x: &[u8]| { v.extend_from_slice(&(x.len() as u32).to_le_bytes()); v.extend_from_slice(x); };
    v.push(1); // Option: present
    v.push(8);
    v.extend_from_slice(&token_id.to_le_bytes());
    v.extend_from_slice(&owner);
    if with_extras {
        v.push(1); s(&mut v, b"https://joezzy-web3.github.io/ctp-concordium/agent-card.json");
        v.push(1); v.extend_from_slice(&[0xb6; 32]);
        v.push(1); v.extend_from_slice(&12801u64.to_le_bytes()); v.extend_from_slice(&0u64.to_le_bytes()); v.push(0);
        s(&mut v, b"near:testnet"); s(&mut v, b"ed25519"); s(&mut v, &[0xac; 32]);
        v.push(1); v.extend_from_slice(&owner);
    } else {
        v.extend_from_slice(&[0, 0, 0, 0]);
    }
    v.push(if active { 0 } else { 1 });
    v.extend_from_slice(&1_795_000_000_000u64.to_le_bytes());
    if active {
        v.extend_from_slice(&[0, 0]);
    } else {
        v.push(1); v.extend_from_slice(&1_795_100_000_000u64.to_le_bytes());
        v.push(1); s(&mut v, b"key compromised");
    }
    if with_extras {
        v.extend_from_slice(&1u32.to_le_bytes());
        s(&mut v, b"agentWallet");
        s(&mut v, &owner);
    } else {
        v.extend_from_slice(&0u32.to_le_bytes());
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: [u8; 32] = [7; 32];

    #[test]
    fn reads_an_active_agent_with_every_optional_field() {
        let b = build_agent_view(1287, OWNER, true, true);
        assert_eq!(parse_agent_of(&b), Ok(Some(AgentInfo { token_id: 1287, owner: OWNER, active: true })));
    }

    /// The real answer of the testnet registry <12802,0> for agentOf(1287), read on 19 Nov 2026.
    const REAL_1287: &str = "010807050000000000009278f55e8366c065c474c07146d2eedea12cdbe67ee9f9c532922aa9858011b8013c00000068747470733a2f2f6a6f657a7a792d776562332e6769746875622e696f2f6374702d636f6e636f726469756d2f6167656e742d636172642e6a736f6e01b6567d9bdb984846f7f72a2769a42485888be98928b11398c6a58be1828e95880101320000000000000000000000000000000c0000006e6561723a746573746e6574070000006564323535313920000000ac3980e34943f80de879e9cff1889d51998076d163b29a53db4dc4f57e4f4582019278f55e8366c065c474c07146d2eedea12cdbe67ee9f9c532922aa9858011b8005b61d3f3a1010000000000000000";

    fn unhex(h: &str) -> std::vec::Vec<u8> { (0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect() }

    #[test]
    fn real_answer_for_agent_1287() {
        let owner: [u8; 32] = unhex("9278f55e8366c065c474c07146d2eedea12cdbe67ee9f9c532922aa9858011b8").try_into().unwrap();
        assert_eq!(parse_agent_of(&unhex(REAL_1287)), Ok(Some(AgentInfo { token_id: 1287, owner, active: true })));
    }

    #[test]
    fn no_such_agent() {
        assert_eq!(parse_agent_of(&[0]), Ok(None));
        assert!(parse_agent_of(&[0, 0]).is_err());
    }

    #[test]
    fn reads_a_minimal_record() {
        let b = build_agent_view(5, OWNER, true, false);
        assert_eq!(parse_agent_of(&b).unwrap().unwrap().token_id, 5);
    }

    #[test]
    fn reads_a_revoked_agent() {
        let b = build_agent_view(1287, OWNER, false, true);
        assert!(!parse_agent_of(&b).unwrap().unwrap().active);
    }

    #[test]
    fn refuses_anything_unexpected() {
        let good = build_agent_view(1287, OWNER, true, true);
        let mut extra = good.clone();
        extra.push(0);
        assert!(parse_agent_of(&extra).is_err());
        assert!(parse_agent_of(&good[..good.len() - 1]).is_err());
        let mut bad_tag = good.clone();
        bad_tag[1] = 9;
        assert!(parse_agent_of(&bad_tag).is_err());
        assert!(parse_agent_of(&[]).is_err());
        // a status byte other than 0 or 1
        let mut min = build_agent_view(5, OWNER, true, false);
        let status_at = 1 + 1 + 8 + 32 + 4;
        min[status_at] = 2;
        assert!(parse_agent_of(&min).is_err());
    }
}
