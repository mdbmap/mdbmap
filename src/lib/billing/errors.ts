type BillingErrorCode = "config" | "customer_missing" | "unresolved_subject";

class BillingError extends Error {
	public readonly code: BillingErrorCode;

	public constructor(code: BillingErrorCode, message: string) {
		super(message);
		this.name = "BillingError";
		this.code = code;
	}
}

const billingConfigError = (message: string): BillingError =>
	new BillingError("config", message);

const billingCustomerMissingError = (): BillingError =>
	new BillingError(
		"customer_missing",
		"No Stripe customer is linked to this account yet.",
	);

const unresolvedBillingSubjectError = (eventType: string): BillingError =>
	new BillingError(
		"unresolved_subject",
		`No user could be resolved for Stripe event type ${eventType}.`,
	);

export {
	billingConfigError,
	billingCustomerMissingError,
	BillingError,
	unresolvedBillingSubjectError,
};
export type { BillingErrorCode };
