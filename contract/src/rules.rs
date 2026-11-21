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
    /// The two gate counts are not both unsealed: the buyer's receiver and the supplier's delivery rep.
    HeldOneSignature,
    /// An unsealed count differs from the ordered quantity (the receiver's, the rep's, or the approver's).
    HeldCountMismatch,
    /// The invoice amount is not the escrowed order amount.
    HeldAmountMismatch,
    /// The supplier has not approved this exact invoice (by its hash) for this exact amount, from its own account.
    HeldNoSupplierApproval,
    /// The supplier's payout account changed less than the hold period ago.
    HeldPayoutCoolOff,
    /// A named approver has not unsealed, and the hold period since the gate counts has not passed.
    HeldApproverWindow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, concordium_std::Serialize, concordium_std::SchemaType)]
pub enum Verdict {
    Cleared,
    Held,
    Seized,
}

/// Who counts a delivery. The receiver (at the gate) and the approver (inside) are chosen by
/// the buyer; the delivery rep is chosen by the supplier when it accepts the order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, concordium_std::Serialize, concordium_std::SchemaType)]
pub enum Role {
    Receiver,
    Approver,
    SupplierRep,
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
    /// The order's referee ruled that the goods were delivered (settles a count dispute).
    pub ruled_delivered: bool,
    /// The order names an approver (a second buyer-side counter inside).
    pub approver_named: bool,
    /// When the receiver's and the rep's counts were both unsealed (milliseconds), if they were.
    pub gate_counted_at: Option<u64>,
    /// When the supplier's payout account was last set (milliseconds).
    pub payout_set_at: u64,
    pub now: u64,
    pub hold_ms: u64,
}

fn count_of<A>(reveals: &[Reveal<A>], role: Role) -> Option<u64> {
    reveals.iter().find(|r| r.role == role).map(|r| r.qty)
}

/// Delivery is confirmed when the buyer's receiver (at the gate) and the supplier's delivery
/// rep both unsealed the ordered quantity, and the buyer's approver (inside), if it unsealed,
/// agrees. Each side has a counter the other side does not choose. The approver can stop a
/// payment only by unsealing a different number, never by staying silent.
pub fn delivery_confirmed<A>(reveals: &[Reveal<A>], expected_qty: u64) -> bool {
    count_of(reveals, Role::Receiver) == Some(expected_qty)
        && count_of(reveals, Role::SupplierRep) == Some(expected_qty)
        && count_of(reveals, Role::Approver).map_or(true, |q| q == expected_qty)
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
    if !f.ruled_delivered {
        if count_of(f.reveals, Role::Receiver).is_none() || count_of(f.reveals, Role::SupplierRep).is_none() {
            codes.push(Code::HeldOneSignature);
        }
        if f.reveals.iter().any(|r| r.qty != f.expected_qty) {
            codes.push(Code::HeldCountMismatch);
        }
        // A named approver gets the hold period after the gate counts to unseal, so a receiver
        // and driver who agree cannot be paid before the approver has counted. Silence never
        // blocks for longer than that.
        if f.approver_named && count_of(f.reveals, Role::Approver).is_none() {
            if let Some(t) = f.gate_counted_at {
                if f.now < t.saturating_add(f.hold_ms) {
                    codes.push(Code::HeldApproverWindow);
                }
            }
        }
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
/// `"CTP-count/v3" ‖ order_id (u64 LE) ‖ round (u8) ‖ signer account (32 bytes) ‖ qty (u64 LE) ‖ salt (32 bytes)`.
/// The signer's own account is inside the seal, so a seal copied from another signer never
/// opens for anyone else. The count round is inside too, so a seal from an earlier round
/// (whose count is already public) cannot be reused after a recount.
pub fn commit_preimage(order_id: u64, round: u8, signer: &[u8; 32], qty: u64, salt: &[u8; 32]) -> [u8; 93] {
    let mut out = [0u8; 93];
    out[..12].copy_from_slice(b"CTP-count/v3");
    out[12..20].copy_from_slice(&order_id.to_le_bytes());
    out[20] = round;
    out[21..53].copy_from_slice(signer);
    out[53..61].copy_from_slice(&qty.to_le_bytes());
    out[61..].copy_from_slice(salt);
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
        Facts { paid: false, expected_qty: 100, order_amount: 1_250, invoice_amount: Some(1_250), supplier_approved: true, reveals, ruled_delivered: false, approver_named: false, gate_counted_at: Some(0), payout_set_at: 0, now: H72, hold_ms: H72 }
    }

    #[test]
    fn clears_when_every_rule_passes() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        assert_eq!(decide(&facts(&rv)), (Verdict::Cleared, vec![]));
    }

    #[test]
    fn one_signature_is_held() {
        let rv = [r(A, Role::Receiver, 100)];
        assert_eq!(decide(&facts(&rv)), (Verdict::Held, vec![Code::HeldOneSignature]));
    }

    #[test]
    fn two_buyer_counts_without_the_supplier_rep_are_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::Approver, 100)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldOneSignature]);
    }

    #[test]
    fn the_rep_alone_is_held() {
        let rv = [r(B, Role::SupplierRep, 100)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldOneSignature]);
    }

    #[test]
    fn a_silent_approver_cannot_block() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        assert_eq!(decide(&facts(&rv)), (Verdict::Cleared, vec![]));
        assert!(delivery_confirmed(&rv, 100));
    }

    #[test]
    fn an_approver_who_disagrees_holds_the_payment() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100), r(3, Role::Approver, 95)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldCountMismatch]);
        assert!(!delivery_confirmed(&rv, 100));
        let agree = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100), r(3, Role::Approver, 100)];
        assert!(delivery_confirmed(&agree, 100));
    }

    #[test]
    fn a_referee_ruling_settles_the_counts_but_not_the_invoice() {
        let rv = [r(A, Role::Receiver, 40), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        assert_eq!(decide(&f).1, vec![Code::HeldCountMismatch]);
        f.ruled_delivered = true;
        assert_eq!(decide(&f), (Verdict::Cleared, vec![]));
        f.supplier_approved = false;
        assert_eq!(decide(&f).1, vec![Code::HeldNoSupplierApproval]);
    }

    #[test]
    fn counts_that_disagree_are_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 90)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldCountMismatch]);
    }

    #[test]
    fn counts_that_agree_but_differ_from_the_order_are_held() {
        let rv = [r(A, Role::Receiver, 80), r(B, Role::SupplierRep, 80)];
        assert_eq!(decide(&facts(&rv)).1, vec![Code::HeldCountMismatch]);
    }

    #[test]
    fn no_invoice_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        f.invoice_amount = None;
        assert_eq!(decide(&f).1, vec![Code::HeldNoInvoice]);
    }

    #[test]
    fn wrong_amount_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        f.invoice_amount = Some(12_500);
        assert_eq!(decide(&f).1, vec![Code::HeldAmountMismatch]);
    }

    #[test]
    fn invoice_without_supplier_approval_is_held() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        f.supplier_approved = false;
        assert_eq!(decide(&f).1, vec![Code::HeldNoSupplierApproval]);
    }

    #[test]
    fn new_payout_account_waits_the_full_hold() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        f.payout_set_at = 10;
        f.now = 10 + H72 - 1;
        assert_eq!(decide(&f).1, vec![Code::HeldPayoutCoolOff]);
        f.now = 10 + H72;
        assert_eq!(decide(&f).0, Verdict::Cleared);
    }

    #[test]
    fn already_paid_is_seized_and_nothing_else_matters() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
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
        assert_eq!(decide(&f).1, vec![Code::HeldNoInvoice, Code::HeldOneSignature, Code::HeldPayoutCoolOff]);
    }

    #[test]
    fn hold_cannot_overflow() {
        let rv = [r(A, Role::Receiver, 100), r(B, Role::SupplierRep, 100)];
        let mut f = facts(&rv);
        f.payout_set_at = u64::MAX;
        assert_eq!(decide(&f).1, vec![Code::HeldPayoutCoolOff]);
    }

    #[test]
    fn commit_preimage_layout() {
        let p = commit_preimage(7, 2, &[3u8; 32], 100, &[9u8; 32]);
        assert_eq!(&p[..12], b"CTP-count/v3");
        assert_eq!(&p[12..20], &7u64.to_le_bytes());
        assert_eq!(p[20], 2);
        assert_eq!(&p[21..53], &[3u8; 32]);
        assert_eq!(&p[53..61], &100u64.to_le_bytes());
        assert_eq!(&p[61..], &[9u8; 32]);
    }

    #[test]
    fn a_named_approver_gets_the_hold_period_after_the_gate_counts() {
        let reveals = [Reveal { signer: A, role: Role::Receiver, qty: 100 }, Reveal { signer: B, role: Role::SupplierRep, qty: 100 }];
        let mut f = facts(&reveals);
        f.approver_named = true;
        f.gate_counted_at = Some(H72);
        f.now = H72 + 1;
        assert_eq!(decide(&f), (Verdict::Held, vec![Code::HeldApproverWindow]));
        f.now = H72 + H72;
        assert_eq!(decide(&f).0, Verdict::Cleared, "silence blocks no longer than the window");
    }

    #[test]
    fn an_approver_who_unseals_ends_the_window_at_once() {
        let reveals = [
            Reveal { signer: A, role: Role::Receiver, qty: 100 },
            Reveal { signer: B, role: Role::SupplierRep, qty: 100 },
            Reveal { signer: 3, role: Role::Approver, qty: 100 },
        ];
        let mut f = facts(&reveals);
        f.approver_named = true;
        f.gate_counted_at = Some(H72);
        f.now = H72 + 1;
        assert_eq!(decide(&f).0, Verdict::Cleared);
    }

    #[test]
    fn no_approver_means_no_window() {
        let reveals = [Reveal { signer: A, role: Role::Receiver, qty: 100 }, Reveal { signer: B, role: Role::SupplierRep, qty: 100 }];
        let mut f = facts(&reveals);
        f.gate_counted_at = Some(H72);
        f.now = H72 + 1;
        assert_eq!(decide(&f).0, Verdict::Cleared);
    }
}
