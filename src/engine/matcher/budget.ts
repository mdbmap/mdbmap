interface BudgetSnapshot {
	readonly limit: number;
	readonly remaining: number;
	readonly spent: number;
}

// The accounting hook tiers spend fetch requests against. `spend` grants and
// deducts when the cost fits the remaining budget, and refuses without
// deducting when it would overrun.
interface BudgetLedger {
	readonly snapshot: () => BudgetSnapshot;
	readonly spend: (cost: number) => boolean;
}

const createBudget = (limit: number): BudgetLedger => {
	let spent = 0;
	return {
		snapshot: () => ({ limit, remaining: limit - spent, spent }),
		spend: (cost) => {
			if (cost < 0) {
				throw new Error("matcher: budget spend cannot be negative");
			}
			if (spent + cost > limit) {
				return false;
			}
			spent += cost;
			return true;
		},
	};
};

export { createBudget };
export type { BudgetLedger, BudgetSnapshot };
