/**
 * Pricing. Deliberately simple: merchants buy a monthly image allowance.
 *
 * The unit cost of one image is a fraction of a cent in Claude tokens, so every
 * paid tier is comfortably profitable even at full utilisation. `free` exists to
 * get the merchant to first value before the paywall — they see real alt text on
 * real products before deciding.
 */
export type PlanKey = 'free' | 'starter' | 'growth' | 'agency';

export interface Plan {
  readonly key: PlanKey;
  readonly name: string;
  /** USD per 30 days. 0 means no Shopify charge is created. */
  readonly price: number;
  /** Images that may be processed per calendar month. */
  readonly monthlyImages: number;
  readonly trialDays: number;
  readonly features: readonly string[];
}

export const PLANS: Readonly<Record<PlanKey, Plan>> = {
  free: {
    key: 'free',
    name: 'Free',
    price: 0,
    monthlyImages: 50,
    trialDays: 0,
    features: [
      '50 images per month',
      'AI-written alt text from the actual image',
      'Accessibility coverage dashboard',
    ],
  },
  starter: {
    key: 'starter',
    name: 'Starter',
    price: 9.99,
    monthlyImages: 500,
    trialDays: 7,
    features: [
      '500 images per month',
      'Automatic processing of new products',
      'Brand name and keyword weaving',
      'Full change history with one-click revert',
    ],
  },
  growth: {
    key: 'growth',
    name: 'Growth',
    price: 19.99,
    monthlyImages: 10_000,
    trialDays: 7,
    features: [
      '10,000 images per month',
      'Everything in Starter',
      'Monthly accessibility coverage report',
      'Priority processing queue',
    ],
  },
  agency: {
    key: 'agency',
    name: 'Agency',
    price: 49,
    monthlyImages: 100_000,
    trialDays: 14,
    features: [
      '100,000 images per month',
      'Everything in Growth',
      'Built for stores with very large catalogues',
      'Priority email support',
    ],
  },
} as const;

export const PLAN_ORDER: readonly PlanKey[] = ['free', 'starter', 'growth', 'agency'];

export function getPlan(key: string | null | undefined): Plan {
  return PLANS[(key ?? 'free') as PlanKey] ?? PLANS.free;
}

export function isPaidPlan(key: string | null | undefined): boolean {
  return getPlan(key).price > 0;
}
