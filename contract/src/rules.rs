//! The payment rules, as pure functions with no chain access.
//!
//! `lib.rs` gathers the facts from contract state and calls `decide`; this
//! module alone decides CLEARED / HELD / REFUSED / SEIZED. Keeping it pure
//! means every rule can be read on one screen and tested without a chain.

use concordium_std::Vec;

/// Reason codes. Each one fires on exactly one rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, concordium_std::Serialize, concordium_std::SchemaType)]
pub enum Code {
    /// The order was already paid.
    SeizedAlreadyPaid,
    /// No invoice has been submitted for the order.
    HeldNoInvoice,
    /// Fewer than two revealed counts from two different people in two different roles.
    HeldOneSignature,
    /// The revealed counts differ from each other or from the ordered quantity.
    HeldCountMismatch,
    /// The invoice amount is not the escrowed order amount.
    HeldAmountMismatch,
    /// The supplier has not approved this exact invoice (by its hash) for this exact amount, from its own account.
    HeldNoSupplierApproval,
    /// The supplier's payout account changed less than the hold period ago.
    HeldPayoutCoolOff,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, concordium_std::Serialize, concordium_std::SchemaType)]
pub enum Verdict {
    Cleared,
    Held,
    Seized,
}

/// The role a signer holds in the buying team.
#[derive(Clone, Copy, Debug, PartialEq, Eq, concordium_std::Serialize, concordium_std::SchemaType)]
pub enum Role {
    Receiver,
    Approver,
}

/// One revealed blind count: who, in which role, and the number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reveal<A> {
    pub signer: A,
    pub role: Role,
    pub qty: u64,
}

/// Everything the rules look at, gathered by the contract.
pub struct Facts<'a, A> {
    pub paid: bool,
    pub expected_qty: u64,
    pub order_amount: u64,
    /// Invoice amount, if an invoice was submitted.
    pub invoice_amount: Option<u64>,
    /// True when the supplier approved the hash AND the amount of the submitted invoice.
    pub supplier_approved: bool,
    pub reveals: &'a [Reveal<A>],
    /// When the supplier's payout account was last set (milliseconds).
    pub payout_set_at: u64,
    pub now: u64,
    pub hold_ms: u64,
}

/// True when two reveals come from different accounts in different roles.
fn two_people_two_roles<A: PartialEq>(reveals: &[Reveal<A>]) -> bool {
    reveals.iter().enumerate().any(|(i, a)| reveals[i + 1..].iter().any(|b| a.signer != b.signer && a.role != b.role))
}

/// Applies every rule and returns the verdict with all codes that fired, in rule order.
pub fn decide<A: PartialEq>(f: &Facts<A>) -> (Verdict, Vec<Code>) {
    let mut codes = Vec::new();
    if f.paid {
        codes.push(Code::SeizedAlreadyPaid);
        return (Verdict::Seized, codes);
    }
    if f.invoice_amount.is_none() {
        codes.push(Code::HeldNoInvoice);
    }
    if !two_people_two_roles(f.reveals) {
        codes.push(Code::HeldOneSignature);
    }
    if f.reveals.is_empty() || f.reveals.iter().any(|r| r.qty != f.expected_qty) {
        codes.push(Code::HeldCountMismatch);
    }
    if let Some(amount) = f.invoice_amount {
        if amount != f.order_amount {
            codes.push(Code::HeldAmountMismatch);
        }
    }
    if f.invoice_amount.is_some() && !f.supplier_approved {
        codes.push(Code::HeldNoSupplierApproval);
    }
    if f.now < f.payout_set_at.saturating_add(f.hold_ms) {
        codes.push(Code::HeldPayoutCoolOff);
    }
    let verdict = if codes.is_empty() { Verdict::Cleared } else { Verdict::Held };
    (verdict, codes)
}

/// The bytes a signer hashes to commit a blind count:
/// `"CTP-count/v2" ‖ order_id (u64 LE) ‖ signer account (32 bytes) ‖ qty (u64 LE) ‖ salt (32 bytes)`.
/// The signer's own account is inside the seal, so a seal copied by the other signer
/// never opens for them: each person must count and seal for themselves.
pub fn commit_preimage(order_id: u64, signer: &[u8; 32], qty: u64, salt: &[u8; 32]) -> [u8; 92] {
    let mut out = [0u8; 92];
    out[..12].copy_from_slice(b"CTP-count/v2");
    out[12..20].copy_from_slice(&order_id.to_le_bytes());
    out[20..52].copy_from_slice(signer);
    out[52..60].copy_from_slice(&qty.to_le_bytes());
    out[60..].copy_from_slice(salt);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const H72: u64 = 72 * 3600 * 1000;
    const A: u8 = 1;
    const B: u8 = 2;

    fn r(signer: u8, role: Role, qty: u64) -> Reveal<u8> { Reveal { signer, role, qty } }

    fn facts<'a>(reveals: &'a [Reveal<u8>]) -> Facts<'a, u8> {
        Facts { paid: false, expected_qty: 100, order_amount: 1_250, invoice_amount: Some(1_250), supplier_approved: true, reveals, payout_set_at: 0, now: H72, hold_ms: H72 }
    }

    #[test]
    fn clears_when_every_rule_passes() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        assert_eq!(decide(&facts(&rv)), (Verdict::Cleared, vec![]));
    }

    #[test]
    fn one_signature_is_held() {
        let rv = [r(A, Role::Receiver, 100)];
        assert_eq!(decide(&facts(&rv)), (Verdict::Held, vec![Code::HeldOneSignature]));
    }

    #[test]
    fn same_person_twice_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(A, Role::Approver, 100)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldOneSignature]);
    }

    #[test]
    fn two_people_same_role_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Receiver, 100)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldOneSignature]);
    }

    #[test]
    fn counts_that_disagree_are_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 90)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldCountMismatch]);
    }

    #[test]
    fn counts_that_agree_but_differ_from_the_order_are_held() {
        let rv = [r(A, Role::Receiver, 80), r(B, Role::Approver, 80)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldCountMismatch]);
    }

    #[test]
    fn no_invoice_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.invoice_amount = None;
        assert_eq!(decide(&f).1, vec![Code::HeldNoInvoice]);
    }

    #[test]
    fn wrong_amount_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.invoice_amount = Some(12_500);
        assert_eq!(decide(&f).1, vec![Code::HeldAmountMismatch]);
    }

    #[test]
    fn invoice_without_supplier_approval_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.supplier_approved = false;
        assert_eq!(decide(&f).1, vec![Code::HeldNoSupplierApproval]);
    }

    #[test]
    fn new_payout_account_waits_the_full_hold() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.payout_set_at = 10;
        f.now = 10 + H72 - 1;
        assert_eq!(decide(&f).1, vec![Code::HeldPayoutCoolOff]);
        f.now = 10 + H72;
        assert_eq!(decide(&f).0, Verdict::Cleared);
    }

    #[test]
    fn already_paid_is_seized_and_nothing_else_matters() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.paid = true;
        assert_eq!(decide(&f), (Verdict::Seized, vec![Code::SeizedAlreadyPaid]));
    }

    #[test]
    fn every_failing_rule_is_reported_in_order() {
        let rv: [Reveal<u8>; 0] = [];
        let mut f = facts(&rv);
        f.invoice_amount = None;
        f.payout_set_at = f.now;
        assert_eq!(decide(&f).1, vec![Code::HeldNoInvoice, Code::HeldOneSignature, Code::HeldCountMismatch, Code::HeldPayoutCoolOff]);
    }

    #[test]
    fn hold_cannot_overflow() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        let mut f = facts(&rv);
        f.payout_set_at = u64::MAX;
        assert_eq!(decide(&f).1, vec![Code::HeldPayoutCoolOff]);
    }

    #[test]
    fn commit_preimage_layout() {
        let p = commit_preimage(7, &[3u8; 32], 100, &[9u8; 32]);
        assert_eq!(&p[..12], b"CTP-count/v2");
        assert_eq!(&p[12..20], &7u64.to_le_bytes());
        assert_eq!(&p[20..52], &[3u8; 32]);
        assert_eq!(&p[52..60], &100u64.to_le_bytes());
        assert_eq!(&p[60..], &[9u8; 32]);
    }
}
