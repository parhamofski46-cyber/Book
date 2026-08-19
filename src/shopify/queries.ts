/**
 * Every GraphQL document the app sends, in one place.
 *
 * Alt text lives on `Media.alt`, and the supported way to change it on current
 * API versions is `fileUpdate` — `productUpdateMedia` was deprecated. That is
 * why the app requests `write_files` alongside `write_products`.
 */

export const SHOP_INFO = /* GraphQL */ `
  query ShopInfo {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      billingAddress {
        countryCodeV2
      }
      plan {
        displayName
        partnerDevelopment
        shopifyPlus
      }
    }
    shopLocales(published: true) {
      locale
      primary
    }
  }
`;

/**
 * Catalogue sweep. Page sizes are chosen to keep the calculated query cost well
 * inside Shopify's 2,000-point bucket: 2 + 20 × (1 + 52) ≈ 1,062 points.
 */
export const PRODUCTS_PAGE = /* GraphQL */ `
  query ProductsPage($first: Int!, $after: String, $mediaFirst: Int!) {
    products(first: $first, after: $after, sortKey: ID) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        productType
        vendor
        status
        media(first: $mediaFirst) {
          pageInfo {
            hasNextPage
          }
          nodes {
            ... on MediaImage {
              id
              alt
              image {
                url
                width
                height
              }
            }
          }
        }
      }
    }
  }
`;

/** Used for webhook-driven updates and for products with more media than one page. */
export const PRODUCT_MEDIA = /* GraphQL */ `
  query ProductMedia($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      title
      handle
      productType
      vendor
      status
      media(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ... on MediaImage {
            id
            alt
            image {
              url
              width
              height
            }
          }
        }
      }
    }
  }
`;

export const FILE_UPDATE = /* GraphQL */ `
  mutation UpdateFileAlt($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        ... on MediaImage {
          id
          alt
        }
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

export const WEBHOOK_LIST = /* GraphQL */ `
  query WebhookList($first: Int!) {
    webhookSubscriptions(first: $first) {
      nodes {
        id
        topic
        endpoint {
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

export const WEBHOOK_CREATE = /* GraphQL */ `
  mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      webhookSubscription {
        id
        topic
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const WEBHOOK_DELETE = /* GraphQL */ `
  mutation WebhookDelete($id: ID!) {
    webhookSubscriptionDelete(id: $id) {
      deletedWebhookSubscriptionId
      userErrors {
        field
        message
      }
    }
  }
`;

export const ACTIVE_SUBSCRIPTIONS = /* GraphQL */ `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
    }
  }
`;

export const SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation SubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $amount: Decimal!
    $currencyCode: CurrencyCode!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: $amount, currencyCode: $currencyCode }
              interval: EVERY_30_DAYS
            }
          }
        }
      ]
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

export const SUBSCRIPTION_CANCEL = /* GraphQL */ `
  mutation SubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// --- Response shapes -------------------------------------------------------

export interface MediaImageNode {
  id?: string;
  alt?: string | null;
  image?: { url: string; width: number | null; height: number | null } | null;
}

export interface ProductNode {
  id: string;
  title: string;
  handle: string;
  productType: string | null;
  vendor: string | null;
  status: string;
  media: {
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    nodes: MediaImageNode[];
  };
}

export interface ProductsPageData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

export interface ProductMediaData {
  product: ProductNode | null;
}

export interface ShopInfoData {
  shop: {
    id: string;
    name: string;
    email: string | null;
    myshopifyDomain: string;
    currencyCode: string;
    billingAddress: { countryCodeV2: string | null } | null;
    plan: { displayName: string; partnerDevelopment: boolean; shopifyPlus: boolean };
  };
  shopLocales: Array<{ locale: string; primary: boolean }>;
}
