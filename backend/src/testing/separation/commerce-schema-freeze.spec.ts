/**
 * Phase 6.0 — the PDPA column allow-list (design §1.4.1) and the Layer 1
 * "no Prisma relation into the payout side" guarantee (design §2.1, ADR-6.1).
 *
 * Both assertions read `Prisma.dmmf`, the datamodel embedded in the GENERATED
 * client, rather than parsing `schema.prisma` as text or querying a database.
 * That choice matters twice over:
 *
 *   - It is what the application actually sees. Layer 1's whole claim is about
 *     the CLIENT TYPE GRAPH — `prisma.post.findMany({ include: { … } })` is
 *     legal or not according to the generated client, not according to a file
 *     on disk. Asserting against the dmmf asserts against the real thing.
 *   - It needs no Postgres, so it runs in the fast unit suite that every
 *     developer already runs (System Analyst condition A6 / B1). A test that
 *     only runs in a DB job is a test most breaches never meet.
 *
 * The e2e suite (test/payout-unaffected-by-commerce.e2e-spec.ts) additionally
 * compares this same allow-list against `information_schema.columns`, so the
 * physical table and the client agree.
 */

import { Prisma } from '@prisma/client';
import { COMMERCE_TABLE_COLUMNS } from '../../modules/commerce/commerce.constants';

/** The five commerce models, by Prisma model name → physical table name. */
const COMMERCE_MODELS: Record<string, string> = {
  CommerceProduct: 'commerce_products',
  AffiliateLink: 'affiliate_links',
  ProductAnchor: 'product_anchors',
  CommercePlacement: 'commerce_placements',
  CommerceConversion: 'commerce_conversions',
};

/**
 * Models on the payout / core side that no commerce model may declare a Prisma
 * relation to. The FKs to these tables are real — they are hand-written
 * `ALTER TABLE` DDL in the migration — but Prisma must not know about them,
 * because Prisma requires a back-relation on BOTH sides: the moment
 * `ProductAnchor` declares `post Post @relation(...)`, `Post` GAINS
 * `productAnchors ProductAnchor[]` and the traversal becomes a legal,
 * type-checked call inside DashboardService.
 */
const FORBIDDEN_RELATION_TARGETS = ['Post', 'Content', 'ContentAsset', 'User'];

function model(name: string) {
  const found = Prisma.dmmf.datamodel.models.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`Model ${name} is missing from the generated Prisma client`);
  }
  return found;
}

/** Physical column names of a model, in declaration order. */
function columnsOf(modelName: string): string[] {
  return model(modelName)
    .fields.filter((field) => field.kind !== 'object')
    .map((field) => field.dbName ?? field.name);
}

describe('Phase 6 separation — commerce schema freeze', () => {
  describe('PDPA column allow-list (design §1.4.1)', () => {
    /**
     * An allow-list, not a deny-list of `%buyer%` / `%order_id%` patterns:
     * a deny-list only catches the names somebody thought to ban, while this
     * also catches `customer_ref`, `recipient`, `contact`, and everything else
     * nobody anticipated. Any NEW column fails until someone edits
     * COMMERCE_TABLE_COLUMNS — and that diff IS the review moment the
     * no-buyer-data rule needs.
     */
    it.each(Object.entries(COMMERCE_MODELS))(
      '%s columns deep-equal the frozen allow-list',
      (modelName, tableName) => {
        expect(columnsOf(modelName)).toEqual(COMMERCE_TABLE_COLUMNS[tableName]);
      },
    );

    it('the allow-list covers exactly the five commerce tables', () => {
      expect(Object.keys(COMMERCE_TABLE_COLUMNS).sort()).toEqual(
        Object.values(COMMERCE_MODELS).sort(),
      );
    });

    it('no commerce column name suggests buyer, order or contact data', () => {
      // A second, weaker net under the allow-list. It cannot catch a
      // creatively-named column — that is the allow-list's job — but it makes
      // the intent of the rule legible at the point of failure.
      //
      // Scanned against the LIVE columns, not against COMMERCE_TABLE_COLUMNS.
      // Reading the frozen literal would have made this test a tautology: it
      // would only ever fire AFTER someone had already added the banned column
      // to the allow-list, i.e. never at the moment it would help. Confirmed
      // by breaking it — a `buyer_email` field on CommerceConversion left this
      // assertion green while the allow-list caught it.
      const banned = /buyer|customer|recipient|order_id|address|phone|email|contact/i;
      const offenders = Object.entries(COMMERCE_MODELS).flatMap(([modelName, tableName]) =>
        columnsOf(modelName)
          .filter((column) => banned.test(column))
          .map((column) => `${tableName}.${column}`),
      );

      expect(offenders).toEqual([]);
    });
  });

  describe('Layer 1 — the client type graph has no edge into commerce', () => {
    it.each(Object.keys(COMMERCE_MODELS))(
      '%s declares no Prisma relation to Post, Content, ContentAsset or User',
      (modelName) => {
        const relations = model(modelName)
          .fields.filter((field) => field.kind === 'object')
          .map((field) => `${field.name}: ${field.type}`);

        const breaches = relations.filter((relation) =>
          FORBIDDEN_RELATION_TARGETS.some((target) => relation.endsWith(`: ${target}`)),
        );

        expect(breaches).toEqual([]);
      },
    );

    it.each(FORBIDDEN_RELATION_TARGETS)(
      '%s gains no back-relation from any commerce model',
      (targetName) => {
        // The consequence, asserted from the other side. If this fails,
        // `prisma.post.findMany({ include: { productAnchors: true } })` has
        // become spellable inside DashboardService and the phase's primary
        // separation guarantee is gone.
        const backRelations = model(targetName)
          .fields.filter((field) => field.kind === 'object')
          .filter((field) => Object.keys(COMMERCE_MODELS).includes(field.type))
          .map((field) => `${targetName}.${field.name}`);

        expect(backRelations).toEqual([]);
      },
    );

    it('no payout-side model declares a relation to a commerce model at all', () => {
      const commerceModelNames = Object.keys(COMMERCE_MODELS);
      const offenders = Prisma.dmmf.datamodel.models
        .filter((entry) => !commerceModelNames.includes(entry.name))
        .flatMap((entry) =>
          entry.fields
            .filter((field) => field.kind === 'object' && commerceModelNames.includes(field.type))
            .map((field) => `${entry.name}.${field.name}: ${field.type}`),
        );

      expect(offenders).toEqual([]);
    });
  });
});
